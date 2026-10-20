import React, { useEffect, useState } from "react";
import { Linking, ScrollView, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import Screen from "../components/Screen";
import VoicePickerModal from "../components/VoicePickerModal";
import { Colors, Radius, Spacing, Typography } from "../theme";
import { useVoiceStore } from "../state/voiceState";
import { useFolderStore } from "../state/folderState";
import { changeAuRecipeSetting, useSettingsStore } from "../state/settingsState";
import { showModal } from "../state/modalState";
import { createBackup, pickBackupFile, restoreBackup, shareBackup } from "../utils/backup";
import { runSyncReplicaSmoke } from "../db/syncReplicaSmoke";
import { prepareCurrentStashReplica } from "../db/syncReplica";
import { connectStashSync, disconnectStashSync, subscribeStashSyncStatus, StashSyncPreparationRequiredError, type StashSyncStatus } from "../db/syncClient";
import { withAppDb, isRestorePendingOwned } from "../db/database";
import { STASH_SYNC_DEV_TOOLS } from "../utils/syncBuildGate";
import { VoiceMode } from "../utils/readability";

const GITHUB_URL = "https://github.com/zachpmanson/stash";

export default function SettingsScreen() {
  const router = useRouter();
  const [voiceMenu, setVoiceMenu] = useState<VoiceMode | null>(null);
  const [recoveryPending, setRecoveryPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [syncServerUrl, setSyncServerUrl] = useState("");
  const [syncUsername, setSyncUsername] = useState("");
  const [syncPassword, setSyncPassword] = useState("");
  const [syncStatus, setSyncStatus] = useState<StashSyncStatus>({ phase: "stopped" });
  const selectedId = useVoiceStore((s) => s.selectedVoice);
  const quoteId = useVoiceStore((s) => s.quoteVoice);
  const voices = useVoiceStore((s) => s.voices);
  const selectedVoice = voices.find((v) => v.identifier === selectedId);
  const voiceLabel = selectedVoice ? selectedVoice.name : selectedId;
  const quoteVoice = voices.find((v) => v.identifier === quoteId);
  const quoteVoiceLabel = quoteVoice ? quoteVoice.name : quoteId;
  const auRecipe = useSettingsStore((s) => s.auRecipe);

  useEffect(() => {
    const refreshPending = () => { void withAppDb(isRestorePendingOwned).then(setRecoveryPending).catch(console.error); };
    refreshPending();
    return subscribeStashSyncStatus((status) => { setSyncStatus(status); refreshPending(); });
  }, []);

  const handleConnectSync = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await connectStashSync(syncServerUrl, { username: syncUsername, password: syncPassword });
    } catch (e) {
      const needsPreparation = e instanceof StashSyncPreparationRequiredError;
      setSyncStatus({ phase: needsPreparation ? "stopped" : "error", message: e instanceof Error ? e.message : String(e) });
      showModal({ title: needsPreparation ? "Prepare sync first" : "Stash sync could not start", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const handleAuRecipeChange = (enabled: boolean) => {
    void changeAuRecipeSetting(enabled).catch((error) => showModal({ title: "Setting not changed", message: String(error) }));
  };

  const handleSyncSmoke = async () => {
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

  const handlePrepareReplica = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await prepareCurrentStashReplica(auRecipe);
      showModal({
        title: result.seeded ? "Local sync replica prepared" : "Local replica already prepared",
        message: JSON.stringify(result, null, 2),
      });
    } catch (e) {
      showModal({ title: "Local sync replica failed", message: `${e}` });
    } finally {
      setBusy(false);
    }
  };

  const handleBackup = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const zipPath = await createBackup();
      await shareBackup(zipPath);
    } catch (e) {
      showModal({ title: "Backup failed", message: `${e}` });
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async () => {
    if (busy) return;
    setBusy(true);
    let confirmationOwnsBusy = false;
    try {
      const fileUri = await pickBackupFile();
      if (!fileUri) return;
      showModal({
        title: "Restore backup?",
        message: "This replaces this device’s data (a private rollback is retained). Synced backups merge with the server, not replace it. Restored synced data is read-only until the first full merge completes.",
        buttons: [
          { text: "Cancel", style: "cancel", onPress: () => setBusy(false) },
          {
            text: "Restore",
            style: "destructive",
            onPress: async () => {
              try {
                const manifest = await restoreBackup(fileUri);
                setRecoveryPending(manifest.recoveryPending);
                await useFolderStore.getState().refresh();
                showModal({
                  title: "Restored",
                  message: manifest.recoveryPending
                    ? "Restored locally; merging with server is required. Browse read-only, then connect to sync below. Your backup and private pre-restore rollback are retained."
                    : `Restored ${manifest.itemCount} items across ${manifest.folderCount} folders locally.`,
                });
              } catch (e) {
                showModal({ title: "Restore failed", message: `${e}` });
              } finally {
                setBusy(false);
              }
            },
          },
        ],
      });
      confirmationOwnsBusy = true;
    } catch (e) {
      showModal({ title: "Restore error", message: `${e}` });
    } finally {
      if (!confirmationOwnsBusy) setBusy(false);
    }
  };

  return (
    <Screen options={{ title: "Settings" }}>
      <VoicePickerModal visible={voiceMenu !== null} mode={voiceMenu ?? "primary"} onClose={() => setVoiceMenu(null)} />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {recoveryPending && <Text style={styles.pendingBanner}>Restored locally — read-only until a full server merge completes. {STASH_SYNC_DEV_TOOLS ? "Connect to sync below." : "Recovery requires an Android development or explicitly opted-in sync build."}</Text>}
        <Row
          icon="save-alt"
          label="Back up data"
          onPress={() => handleBackup()}
        />
        <Row
          icon="restore"
          label="Restore from backup"
          onPress={() => handleRestore()}
        />
        <Row
          icon="record-voice-over"
          label="Narrator voice"
          value={voiceLabel}
          onPress={() => setVoiceMenu("primary")}
        />
        <Row
          icon="format-quote"
          label="Quote voice"
          value={quoteVoiceLabel}
          onPress={() => setVoiceMenu("quote")}
        />
        <Row
          icon="spellcheck"
          label="Text Substitutions"
          onPress={() => router.push("/text-substitutions")}
        />
        <ToggleRow
          icon="emoji-food-beverage"
          label="Australian recipe ingredients"
          value={auRecipe}
          onValueChange={handleAuRecipeChange}
        />
        {STASH_SYNC_DEV_TOOLS && (
          <>
            <View style={styles.syncPanel}>
              <Text style={styles.syncHeading}>Experimental sync (Android only)</Text>
              <Text style={styles.syncNote}>Experimental: use a disposable Stash backup. Credentials stay in memory and are not saved; sync requires a matching Stash server schema.</Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="https://your-stash-sync-server"
                placeholderTextColor={Colors.textMuted}
                style={styles.syncInput}
                value={syncServerUrl}
                onChangeText={setSyncServerUrl}
              />
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Server username"
                placeholderTextColor={Colors.textMuted}
                style={styles.syncInput}
                value={syncUsername}
                onChangeText={setSyncUsername}
              />
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Server password"
                placeholderTextColor={Colors.textMuted}
                secureTextEntry
                style={styles.syncInput}
                value={syncPassword}
                onChangeText={setSyncPassword}
              />
              <Text style={styles.syncStatus}>{syncStatus.message ?? `Status: ${syncStatus.phase}`}</Text>
              <View style={styles.syncButtons}>
                <Pressable
                  disabled={busy || syncStatus.phase !== "stopped"}
                  style={({ pressed }) => [styles.syncButton, (pressed || busy) && styles.rowPressed]}
                  onPress={() => void handleConnectSync()}
                >
                  <Text style={styles.syncButtonLabel}>Connect and sync</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.syncButton, pressed && styles.rowPressed]}
                  onPress={() => disconnectStashSync()}
                >
                  <Text style={styles.syncButtonLabel}>Disconnect</Text>
                </Pressable>
              </View>
              {STASH_SYNC_DEV_TOOLS && !recoveryPending && <Row icon="sync" label="Prepare this install's local sync replica" onPress={() => handlePrepareReplica()} />}
              {STASH_SYNC_DEV_TOOLS && <Row icon="science" label="Run isolated sync migration smoke" onPress={() => handleSyncSmoke()} />}
            </View>
          </>
        )}
        <Row icon="code" label="GitHub" value="zachpmanson/stash" onPress={() => Linking.openURL(GITHUB_URL)} />
      </ScrollView>
    </Screen>
  );
}

function Row({
  icon,
  label,
  value,
  onPress,
}: {
  icon: React.ComponentProps<typeof MaterialIcons>["name"];
  label: string;
  value?: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={({ pressed }) => [styles.row, pressed && styles.rowPressed]} onPress={onPress}>
      <MaterialIcons name={icon} size={22} color={Colors.text} />
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        {value && (
          <Text style={styles.rowValue} numberOfLines={1}>
            {value}
          </Text>
        )}
      </View>
      <MaterialIcons name="chevron-right" size={22} color={Colors.textMuted} />
    </Pressable>
  );
}

function ToggleRow({
  icon,
  label,
  value,
  onValueChange,
}: {
  icon: React.ComponentProps<typeof MaterialIcons>["name"];
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <MaterialIcons name={icon} size={22} color={Colors.text} />
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
      <Switch value={value} onValueChange={onValueChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  pendingBanner: { ...Typography.body, color: Colors.textSecondary, backgroundColor: Colors.surface2, padding: Spacing.md, borderRadius: Radius.md },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  rowPressed: { opacity: 0.7 },
  rowText: { flex: 1 },
  rowLabel: { ...Typography.body },
  rowValue: { ...Typography.caption, color: Colors.textMuted, marginTop: 2 },
  syncPanel: {
    gap: Spacing.sm,
    backgroundColor: Colors.surface2,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  syncHeading: { ...Typography.body, fontWeight: "600" },
  syncNote: { ...Typography.caption, color: Colors.textMuted },
  syncInput: {
    ...Typography.body,
    color: Colors.text,
    backgroundColor: Colors.bg,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  syncStatus: { ...Typography.caption, color: Colors.textMuted },
  syncButtons: { flexDirection: "row", gap: Spacing.sm },
  syncButton: {
    flex: 1,
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: Radius.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  syncButtonLabel: { ...Typography.body, color: Colors.accent },
});
