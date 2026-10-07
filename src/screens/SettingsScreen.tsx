import React, { useEffect, useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import Screen from "../components/Screen";
import VoicePickerModal from "../components/VoicePickerModal";
import { Colors, Radius, Spacing, Typography } from "../theme";
import { useVoiceStore } from "../state/voiceState";
import { useFolderStore } from "../state/folderState";
import { useSettingsStore } from "../state/settingsState";
import { showModal } from "../state/modalState";
import { createBackup, pickBackupFile, restoreBackup, shareBackup } from "../utils/backup";
import { runSyncReplicaSmoke } from "../db/syncReplicaSmoke";
import { mirrorAuRecipeSetting, prepareCurrentStashReplica } from "../db/syncReplica";
import { connectStashSync, disconnectStashSync, subscribeStashSyncStatus, type StashSyncStatus } from "../db/syncClient";
import { VoiceMode } from "../utils/readability";

const GITHUB_URL = "https://github.com/zachpmanson/stash";
const SHOW_SYNC_DEV_TOOLS = Platform.OS === "android" && (__DEV__ || process.env.EXPO_PUBLIC_STASH_SYNC_DEV_TOOLS === "1");

export default function SettingsScreen() {
  const router = useRouter();
  const [voiceMenu, setVoiceMenu] = useState<VoiceMode | null>(null);
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
  const setAuRecipe = useSettingsStore((s) => s.setAuRecipe);

  useEffect(() => subscribeStashSyncStatus(setSyncStatus), []);

  const handleConnectSync = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await connectStashSync(syncServerUrl, { username: syncUsername, password: syncPassword });
    } catch (e) {
      setSyncStatus({ phase: "error", message: e instanceof Error ? e.message : String(e) });
      showModal({ title: "Stash sync could not start", message: `${e}` });
    } finally {
      setBusy(false);
    }
  };

  const handleAuRecipeChange = (enabled: boolean) => {
    setAuRecipe(enabled);
    void mirrorAuRecipeSetting(enabled).catch((error) => console.error("Failed to mirror recipe setting", error));
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
    try {
      const fileUri = await pickBackupFile();
      if (!fileUri) return;
      showModal({
        title: "Restore backup?",
        message: "This will replace your current data with the selected backup.",
        buttons: [
          { text: "Cancel", style: "cancel" },
          {
            text: "Restore",
            style: "destructive",
            onPress: async () => {
              try {
                const manifest = await restoreBackup(fileUri);
                await useFolderStore.getState().refresh();
                showModal({
                  title: "Restored",
                  message: `Restored ${manifest.itemCount} items across ${manifest.folderCount} folders.`,
                });
              } catch (e) {
                showModal({ title: "Restore failed", message: `${e}` });
              }
            },
          },
        ],
      });
    } catch (e) {
      showModal({ title: "Restore error", message: `${e}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen options={{ title: "Settings" }}>
      <VoicePickerModal visible={voiceMenu !== null} mode={voiceMenu ?? "primary"} onClose={() => setVoiceMenu(null)} />
      <View style={styles.container}>
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
        {SHOW_SYNC_DEV_TOOLS && (
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
              <Row icon="sync" label="Prepare this install's local sync replica" onPress={() => handlePrepareReplica()} />
              <Row icon="science" label="Run isolated sync migration smoke" onPress={() => handleSyncSmoke()} />
            </View>
          </>
        )}
        <Row icon="code" label="GitHub" value="zachpmanson/stash" onPress={() => Linking.openURL(GITHUB_URL)} />
      </View>
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
