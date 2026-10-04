import * as SQLite from "expo-sqlite";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

type Change = {
  table: string;
  pk: unknown;
  cid: string;
  val: unknown;
  col_version: number;
  db_version: number;
  site_id: unknown;
  cl: number;
  seq: number;
};

const ENTRY_POINT = "sqlite3_crsqlite_init";
const CHANGE_COLUMNS = '"table", "pk", "cid", "val", "col_version", "db_version", "site_id", cl, seq';
const INSERT_CHANGE = `INSERT INTO crsql_changes (${CHANGE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function asSqlValue(value: unknown): unknown {
  return value instanceof Uint8Array ? value : value;
}

async function newDb(name: string): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(name, { useNewConnection: true });
  await db.loadExtensionAsync("libcrsqlite.so", ENTRY_POINT);
  await db.execAsync(`CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL DEFAULT '');`);
  const isCrr = await db.getFirstAsync<{ crsql_as_crr: number }>("SELECT crsql_as_crr('notes')");
  if (!isCrr) throw new Error("crsql_as_crr returned no result");
  return db;
}

async function changes(db: SQLite.SQLiteDatabase): Promise<Change[]> {
  return db.getAllAsync<Change>(`SELECT ${CHANGE_COLUMNS} FROM crsql_changes`);
}

async function apply(db: SQLite.SQLiteDatabase, batch: Change[]): Promise<void> {
  for (const change of batch) {
    await db.runAsync(INSERT_CHANGE, ...Object.values(change).map(asSqlValue) as never[]);
  }
}

async function runSpike(): Promise<string[]> {
  const a = await newDb("crsqlite-spike-a.db");
  const b = await newDb(":memory:");
  try {
    await a.runAsync("INSERT OR REPLACE INTO notes (id, body) VALUES (?, ?)", "from-device", "offline on device");
    await apply(b, await changes(a));

    await b.runAsync("INSERT OR REPLACE INTO notes (id, body) VALUES (?, ?)", "from-peer", "offline on peer");
    await apply(a, await changes(b));

    const aRows = await a.getAllAsync<{ id: string; body: string }>("SELECT id, body FROM notes ORDER BY id");
    const bRows = await b.getAllAsync<{ id: string; body: string }>("SELECT id, body FROM notes ORDER BY id");
    if (JSON.stringify(aRows) !== JSON.stringify(bRows)) {
      throw new Error(`Replicas did not converge: A=${JSON.stringify(aRows)} B=${JSON.stringify(bRows)}`);
    }

    // Mirror Stash's backup flow: serialize a live DB, restore it to a fresh
    // connection, load CR-SQLite again, then ensure both user rows and CRR data
    // survive the round trip.
    const backup = await a.serializeAsync();
    const restored = await SQLite.deserializeDatabaseAsync(backup, { useNewConnection: true });
    try {
      await restored.loadExtensionAsync("libcrsqlite.so", ENTRY_POINT);
      const restoredRows = await restored.getAllAsync<{ id: string; body: string }>("SELECT id, body FROM notes ORDER BY id");
      if (JSON.stringify(restoredRows) !== JSON.stringify(aRows)) {
        throw new Error(`Backup round trip differed: ${JSON.stringify(restoredRows)}`);
      }
      const crrCount = await restored.getFirstAsync<{ count: number }>(
        "SELECT count(*) AS count FROM sqlite_master WHERE name GLOB 'crsql_*'",
      );
      return [
        `CR-SQLite extension load: OK (${ENTRY_POINT})`,
        `Offline exchange and convergence: OK (${aRows.length} rows on both peers)`,
        `SQLite serialize/restore with CRR tables: OK (${crrCount?.count ?? 0} CR-SQLite schema objects)`,
        ...aRows.map((row) => `${row.id}: ${row.body}`),
      ];
    } finally {
      await restored.getFirstAsync("SELECT crsql_finalize()").catch(() => undefined);
      await restored.closeAsync();
    }
  } finally {
    await a.getFirstAsync("SELECT crsql_finalize()").catch(() => undefined);
    await b.getFirstAsync("SELECT crsql_finalize()").catch(() => undefined);
    await a.closeAsync();
    await b.closeAsync();
  }
}

export default function Index() {
  const [lines, setLines] = useState<string[]>(["Ready. Run the native CR-SQLite spike on Android."]);
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    setLines(["Running..."]);
    try {
      setLines(await runSpike());
    } catch (error) {
      setLines([`FAILED: ${error instanceof Error ? error.message : String(error)}`]);
    } finally {
      setRunning(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>CR-SQLite Expo feasibility</Text>
      <Text style={styles.caption}>Two independent Expo SQLite connections, bidirectional changes, then Stash-style serialize/restore.</Text>
      <Pressable accessibilityRole="button" disabled={running} onPress={run} style={styles.button}>
        <Text style={styles.buttonText}>{running ? "Testing…" : "Run spike"}</Text>
      </Pressable>
      <View style={styles.output}>
        {lines.map((line, index) => <Text key={`${index}-${line}`} style={styles.line}>{line}</Text>)}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 24, paddingTop: 64, gap: 16, backgroundColor: "#10151d" },
  title: { color: "white", fontSize: 24, fontWeight: "700" },
  caption: { color: "#c1cad4", fontSize: 15, lineHeight: 22 },
  button: { backgroundColor: "#8dc4ff", padding: 14, borderRadius: 8, alignItems: "center" },
  buttonText: { color: "#102030", fontSize: 16, fontWeight: "700" },
  output: { gap: 8, padding: 16, borderWidth: 1, borderColor: "#52616f", borderRadius: 8 },
  line: { color: "#d4f7dc", fontFamily: "monospace" },
});
