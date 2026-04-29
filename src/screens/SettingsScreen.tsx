import React, { useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import Screen from "../components/Screen";
import VoicePickerModal from "../components/VoicePickerModal";
import { Colors, Radius, Spacing, Typography } from "../theme";
import { useVoiceStore } from "../state/voiceState";

const GITHUB_URL = "https://github.com/zachpmanson/stash";

export default function SettingsScreen() {
  const [voiceMenuOpen, setVoiceMenuOpen] = useState(false);
  const selectedId = useVoiceStore((s) => s.selectedVoice);
  const voices = useVoiceStore((s) => s.voices);
  const selectedVoice = voices.find((v) => v.identifier === selectedId);
  const voiceLabel = selectedVoice ? selectedVoice.name : selectedId;

  return (
    <Screen options={{ title: "Settings" }}>
      <VoicePickerModal visible={voiceMenuOpen} onClose={() => setVoiceMenuOpen(false)} />
      <View style={styles.container}>
        <Row
          icon="record-voice-over"
          label="Voice"
          value={voiceLabel}
          onPress={() => setVoiceMenuOpen(true)}
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
