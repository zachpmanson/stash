import React, { useState } from "react";
import { Linking, Pressable, StyleSheet, Switch, Text, View } from "react-native";
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
import { VoiceMode } from "../utils/readability";

const GITHUB_URL = "https://github.com/zachpmanson/stash";

export default function SettingsScreen() {
  const router = useRouter();
  const [voiceMenu, setVoiceMenu] = useState<VoiceMode | null>(null);
  const [busy, setBusy] = useState(false);
  const selectedId = useVoiceStore((s) => s.selectedVoice);
  const quoteId = useVoiceStore((s) => s.quoteVoice);
  const voices = useVoiceStore((s) => s.voices);
  const selectedVoice = voices.find((v) => v.identifier === selectedId);
  const voiceLabel = selectedVoice ? selectedVoice.name : selectedId;
  const quoteVoice = voices.find((v) => v.identifier === quoteId);
  const quoteVoiceLabel = quoteVoice ? quoteVoice.name : quoteId;
  const auRecipe = useSettingsStore((s) => s.auRecipe);
  const setAuRecipe = useSettingsStore((s) => s.setAuRecipe);

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
          onValueChange={setAuRecipe}
        />
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
});
