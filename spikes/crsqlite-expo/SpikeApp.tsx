import { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { backupRestoreZip, createAndroidNote, listNotes, startSync, waitForConvergence, type Note } from "./networkSync";

const DEFAULT_SERVER_URL = "http://127.0.0.1:8787";

type SyncHandle = { stop: () => boolean };

export default function Index() {
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [lines, setLines] = useState<string[]>([
    "1. Start the Node server and seed its offline row.",
    "2. Write an Android row while disconnected.",
    "3. Connect and verify both server and Android hold both rows.",
  ]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [androidNoteId, setAndroidNoteId] = useState<string | null>(null);
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
        Separate Expo Android and persistent Node peers using @vlcn.io/ws-client / ws-server.
        Write independently while offline, then reconnect and verify both databases.
      </Text>
      <TextInput
        accessibilityLabel="Server URL"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setServerUrl}
        value={serverUrl}
        style={styles.input}
      />
      <Pressable accessibilityRole="button" disabled={running} onPress={() => run("Seeding server", async () => {
        const response = await fetch(`${serverUrl.replace(/\/$/, "")}/test/offline-write`, { method: "POST" });
        if (!response.ok) throw new Error(`Server seed failed: HTTP ${response.status}`);
        setLines(["Server offline row written. Android is still disconnected."]);
      })} style={styles.button}>
        <Text style={styles.buttonText}>Write server row (offline)</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={running} onPress={() => run("Writing Android row", async () => {
        const note = await createAndroidNote(`android-${Date.now()}`);
        setAndroidNoteId(note.id);
        setNotes(await listNotes());
        setLines([`Android row written locally: ${note.id}`, "No sync connection was opened."]);
      })} style={styles.button}>
        <Text style={styles.buttonText}>Write Android row (offline)</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={running} onPress={() => run("Connecting peers", async () => {
        if (!androidNoteId) throw new Error("Write the Android offline row first.");
        if (!sync.current) sync.current = await startSync(serverUrl);
        const converged = await waitForConvergence(serverUrl, androidNoteId);
        setNotes(converged);
        setLines([
          "PASS: independently-written rows converged on Android and server.",
          `Android row: ${androidNoteId}`,
          "Server row: server-offline",
          "Disconnect/reconnect and press again to check idempotence/reconnect.",
        ]);
      })} style={styles.button}>
        <Text style={styles.buttonText}>{sync.current ? "Reconnect + verify" : "Connect + verify"}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={running || !sync.current} onPress={() => run("Backing up/restoring ZIP", async () => {
        if (!androidNoteId) throw new Error("Write the Android offline row first.");
        sync.current?.stop();
        sync.current = null;
        const restored = await backupRestoreZip();
        sync.current = await startSync(serverUrl);
        const converged = await waitForConvergence(serverUrl, androidNoteId);
        setNotes(converged);
        setLines([
          "PASS: Stash-style database ZIP backup/restore retained CR-SQLite metadata.",
          `Rows after restore: ${restored.notes.length}; CR-SQLite schema objects: ${restored.crsqlObjects}.`,
          "PASS: restored Android database resumed WebSocket exchange without duplicate rows.",
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
