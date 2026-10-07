import { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { backupRestoreZip, createAndroidNote, createObserverNote, listNotes, startSync, waitForConvergence, type Note } from "./networkSync";
import { runCandidateSchemaSmoke } from "./candidateSchemaSmoke";

const DEFAULT_SERVER_URL = "https://stash.zachmanson.com";

type SyncHandle = { stop: () => boolean };

export default function Index() {
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [lines, setLines] = useState<string[]>([
    "1. Enter your Caddy Basic-auth credentials (kept in memory only).",
    "2. Write independent rows to both local replicas while disconnected.",
    "3. Connect both clients to Naboo and verify remote convergence.",
  ]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [username, setUsername] = useState("zach");
  const [password, setPassword] = useState("");
  const [androidNoteId, setAndroidNoteId] = useState<string | null>(null);
  const [observerNoteId, setObserverNoteId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const sync = useRef<SyncHandle | null>(null);

  async function run(label: string, action: () => Promise<void>) {
    setRunning(true);
    setLines([`${label}…`]);
    try {
      await action();
    } catch (error) {
      setLines([`FAILED: ${error instanceof Error ? error.message : String(error)}`]);
    } finally {
      setRunning(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>CR-SQLite Android ↔ server spike</Text>
      <Text style={styles.caption}>
        Two independent CR-SQLite clients sync through the authenticated Naboo server. The password is
        kept in memory only and sent over HTTPS; no server test endpoints are enabled.
      </Text>
      <Pressable accessibilityRole="button" disabled={running} onPress={() => run("Testing candidate Stash schema locally", async () => {
        const result = await runCandidateSchemaSmoke();
        setLines([
          "PASS: candidate Stash schema opened with the Android CR-SQLite extension.",
          `CRR clock tables: ${result.crSqliteTables}; initial changes: ${result.changeRows}; delete tombstones: ${result.deleteTombstones}.`,
          `SQLite integrity_check: ${result.integrity}. No server or Stash production database was opened.`,
        ]);
      })} style={styles.button}>
        <Text style={styles.buttonText}>Smoke-test Stash candidate schema (local only)</Text>
      </Pressable>
      <TextInput
        accessibilityLabel="Server URL"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setServerUrl}
        value={serverUrl}
        placeholder="HTTPS server URL"
        style={styles.input}
      />
      <TextInput
        accessibilityLabel="Caddy username"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setUsername}
        value={username}
        placeholder="Caddy username"
        style={styles.input}
      />
      <TextInput
        accessibilityLabel="Caddy password"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setPassword}
        value={password}
        placeholder="Caddy password (not saved)"
        secureTextEntry
        style={styles.input}
      />
      <Pressable accessibilityRole="button" disabled={running} onPress={() => run("Writing Android row", async () => {
        const note = await createAndroidNote(`android-${Date.now()}`);
        setAndroidNoteId(note.id);
        setNotes(await listNotes());
        setLines([`Android peer wrote ${note.id} while disconnected.`, "Write the observer peer row next."]);
      })} style={styles.button}>
        <Text style={styles.buttonText}>Write Android peer row (offline)</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={running} onPress={() => run("Writing observer row", async () => {
        const note = await createObserverNote(`observer-${Date.now()}`);
        setObserverNoteId(note.id);
        setLines([`Observer peer wrote ${note.id} while disconnected.`, "Connect both peers to Naboo to verify exchange."]);
      })} style={styles.button}>
        <Text style={styles.buttonText}>Write observer peer row (offline)</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={running} onPress={() => run("Connecting authenticated peers", async () => {
        if (!androidNoteId || !observerNoteId) throw new Error("Write one offline row from each peer first.");
        sync.current?.stop();
        sync.current = await startSync(serverUrl, { username, password });
        const converged = await waitForConvergence(androidNoteId, observerNoteId);
        setNotes(converged);
        setLines([
          "PASS: authenticated Android peers exchanged their offline rows through Naboo.",
          `Android row: ${androidNoteId}`,
          `Observer row: ${observerNoteId}`,
          "Disconnect/reconnect and press again to check idempotence/reconnect.",
        ]);
      })} style={styles.button}>
        <Text style={styles.buttonText}>{sync.current ? "Reconnect + verify" : "Connect + verify"}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={running || !sync.current} onPress={() => run("Backing up/restoring ZIP", async () => {
        if (!androidNoteId || !observerNoteId) throw new Error("Write one offline row from each peer first.");
        sync.current?.stop();
        sync.current = null;
        const restored = await backupRestoreZip();
        sync.current = await startSync(serverUrl, { username, password });
        const converged = await waitForConvergence(androidNoteId, observerNoteId);
        setNotes(converged);
        setLines([
          "PASS: Stash-style backup/restore retained CR-SQLite metadata.",
          `Rows after restore: ${restored.notes.length}; CR-SQLite schema objects: ${restored.crsqlObjects}.`,
          "PASS: restored Android peer resumed authenticated exchange with its observer.",
        ]);
      })} style={styles.button}>
        <Text style={styles.buttonText}>Backup ZIP → restore → reconnect</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={running || !sync.current} onPress={() => run("Disconnecting", async () => {
        sync.current?.stop();
        sync.current = null;
        setLines(["Disconnected. Local writes remain available; reconnect to resume exchange."]);
      })} style={[styles.button, styles.secondary]}>
        <Text style={styles.buttonText}>Disconnect</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={running} onPress={() => run("Reading local database", async () => {
        const current = await listNotes();
        setNotes(current);
        setLines([`Local database: ${current.length} note(s).`]);
      })} style={[styles.button, styles.secondary]}>
        <Text style={styles.buttonText}>Refresh local rows</Text>
      </Pressable>
      <View style={styles.output}>
        {lines.map((line, index) => <Text key={`${index}-${line}`} style={styles.line}>{line}</Text>)}
        {notes.map((note) => <Text key={note.id} style={styles.note}>{note.id}: {note.body}</Text>)}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 24, paddingTop: 64, gap: 14, backgroundColor: "#10151d" },
  title: { color: "white", fontSize: 24, fontWeight: "700" },
  caption: { color: "#c1cad4", fontSize: 15, lineHeight: 22 },
  input: { backgroundColor: "#202a35", borderColor: "#52616f", borderWidth: 1, borderRadius: 8, color: "white", padding: 12 },
  button: { backgroundColor: "#8dc4ff", padding: 14, borderRadius: 8, alignItems: "center" },
  secondary: { backgroundColor: "#52616f" },
  buttonText: { color: "#102030", fontSize: 16, fontWeight: "700" },
  output: { gap: 8, padding: 16, borderWidth: 1, borderColor: "#52616f", borderRadius: 8 },
  line: { color: "#d4f7dc", fontFamily: "monospace" },
  note: { color: "#c1cad4", fontFamily: "monospace", fontSize: 12 },
});
