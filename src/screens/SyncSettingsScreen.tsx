import React, { useEffect, useState } from "react";
import { ScrollView, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Screen from "../components/Screen";
import { Colors, Radius, Spacing, Typography } from "../theme";
import { useSettingsStore } from "../state/settingsState";
import { showModal } from "../state/modalState";
import { runSyncReplicaSmoke } from "../db/syncReplicaSmoke";
import { prepareCurrentStashReplica } from "../db/syncReplica";
import { connectStashSync, disconnectStashSyncAndWait, subscribeStashSyncStatus, StashSyncPreparationRequiredError, type StashSyncStatus } from "../db/syncClient";
import { withAppDb, isRestorePendingOwned } from "../db/database";
import { STASH_SYNC_DEV_TOOLS } from "../utils/syncBuildGate";

export default function SyncSettingsScreen() {
  const [recoveryPending, setRecoveryPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverUrl, setServerUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<StashSyncStatus | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const auRecipe = useSettingsStore((s) => s.auRecipe);

  useEffect(() => {
    if (!STASH_SYNC_DEV_TOOLS) return;
    const refreshPending = () => { void withAppDb(isRestorePendingOwned).then(setRecoveryPending).catch(console.error); };
    refreshPending();
    return subscribeStashSyncStatus((next) => { setStatus(next); refreshPending(); });
  }, []);

  const handleConnect = async () => {
    if (!status || busy || signingOut || status.disconnecting || status.restartRequired || status.account || status.phase === "connecting") return;
    setBusy(true);
    try {
      await connectStashSync(serverUrl, { username, password });
      setPassword("");
    } catch (e) {
      const needsPreparation = e instanceof StashSyncPreparationRequiredError;
      showModal({ title: needsPreparation ? "Prepare sync first" : "Stash sync could not start", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setPassword("");
    try {
      await disconnectStashSyncAndWait();
      setSigningOut(false);
    } catch (e) {
      // Teardown cannot prove callbacks have stopped. Do not offer another connection.
      setSignOutError("Sign out could not finish. Restart the app before reconnecting.");
      showModal({ title: "Sign out failed", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const handleSmoke = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await runSyncReplicaSmoke();
      showModal({ title: "Sync migration smoke passed", message: JSON.stringify(result, null, 2) });
    } catch (e) {
      showModal({ title: "Sync migration smoke failed", message: `${e}` });
    } finally {
      setBusy(false);
    }
  };

  const handlePrepare = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await prepareCurrentStashReplica(auRecipe);
      showModal({ title: result.seeded ? "Local sync replica prepared" : "Local replica already prepared", message: JSON.stringify(result, null, 2) });
    } catch (e) {
      showModal({ title: "Local sync replica failed", message: `${e}` });
    } finally {
      setBusy(false);
    }
  };

  const connecting = status?.phase === "connecting";
  const disabled = busy || connecting;
  const teardownPending = signingOut || status?.disconnecting;
  const restartRequired = signOutError || status?.restartRequired;
  const hideControls = teardownPending || restartRequired;

  return (
    <Screen options={{ title: "Sync" }}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {!STASH_SYNC_DEV_TOOLS ? <Text style={styles.note}>Sync requires an Android development or explicitly opted-in sync build.</Text> : !status ? <Text style={styles.note}>Checking sync status…</Text> : (
          <View style={styles.panel}>
            <Text style={styles.heading}>Experimental sync (Android only)</Text>
            <Text style={styles.note}>Experimental: use a disposable Stash backup. Credentials stay in memory and are not saved; sync requires a matching Stash server schema.</Text>
            {recoveryPending && <Text style={styles.note}>Restored locally — read-only until a full server merge completes. Connect to sync to finish recovery.</Text>}
            {status.account && !hideControls && <>
              <Text style={styles.heading}>Signed in as {status.account.username}</Text>
              <Text style={styles.note}>{status.account.serverUrl}</Text>
            </>}
            <Text style={styles.note}>{restartRequired ? "Sign out could not finish. Restart the app before reconnecting." : teardownPending ? "Signing out…" : status.message ?? `Status: ${status.phase}`}</Text>
            {hideControls ? null : status.account ? (
              <Action label="Sign out" onPress={() => void handleSignOut()} />
            ) : (
              <>
                <TextInput autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://your-stash-sync-server" placeholderTextColor={Colors.textMuted} style={styles.input} value={serverUrl} onChangeText={setServerUrl} editable={!disabled} />
                <TextInput autoCapitalize="none" autoCorrect={false} placeholder="Server username" placeholderTextColor={Colors.textMuted} style={styles.input} value={username} onChangeText={setUsername} editable={!disabled} />
                <TextInput autoCapitalize="none" autoCorrect={false} placeholder="Server password" placeholderTextColor={Colors.textMuted} secureTextEntry style={styles.input} value={password} onChangeText={setPassword} editable={!disabled} />
                <Action label="Connect and sync" disabled={disabled} onPress={() => void handleConnect()} />
                {connecting && <Action label="Cancel" onPress={() => void handleSignOut()} />}
                {!recoveryPending && <Action label="Prepare this install's local sync replica" disabled={disabled} onPress={() => void handlePrepare()} />}
                <Action label="Run isolated sync migration smoke" disabled={disabled} onPress={() => void handleSmoke()} />
              </>
            )}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function Action({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable disabled={disabled} style={({ pressed }) => [styles.button, (pressed || disabled) && styles.dimmed]} onPress={onPress}>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.md },
  panel: { gap: Spacing.sm, backgroundColor: Colors.surface2, borderRadius: Radius.md, padding: Spacing.md },
  heading: { ...Typography.body, fontWeight: "600" },
  note: { ...Typography.caption, color: Colors.textMuted },
  input: { ...Typography.body, color: Colors.text, backgroundColor: Colors.bg, borderRadius: Radius.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  button: { alignItems: "center", backgroundColor: Colors.surface, borderRadius: Radius.sm, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md },
  dimmed: { opacity: 0.7 },
  label: { ...Typography.body, color: Colors.accent },
});
