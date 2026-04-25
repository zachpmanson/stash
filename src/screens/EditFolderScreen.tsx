import React, { useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, Alert, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Colors, Spacing, Typography, Radius } from "../theme";
import { updateFolderName, updateFolderIcon } from "../db/folders";
import { countGraphemes } from "unicode-segmenter/grapheme";
import Screen from "../components/Screen";

const PRESET_ICONS = [
  "📥",
  "📁",
  "⭐",
  "🏠",
  "🎮",
  "🎵",
  "🔗",
  "📌",
  "🏷️",
  "💡",
  "📚",
  "📄",
  "✉️",
  "📰",
  "🌐",
  "🔑",
  "🎬",
  "🌊",
  "💾",
  "📓",
  "🔴",
  "🔵",
  "💛",
  "⚡",
  "❓",
  "🅰️",
  "❌",
];

export default function EditFolderScreen() {
  const {
    id: folderId,
    folderName,
    folderIcon,
  } = useLocalSearchParams<{ id: string; folderName: string; folderIcon: string }>();
  const router = useRouter();
  const [name, setName] = useState(folderName);
  const [icon, setIcon] = useState(folderIcon ?? "📁");
  const [customInput, setCustomInput] = useState("");

  const handleCustomChange = (text: string) => {
    setCustomInput(text);
    if (countGraphemes(text) === 1) {
      setIcon(text);
    }
  };

  const handlePresetPress = (emoji: string) => {
    setIcon(emoji);
    setCustomInput("");
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert("Enter a name");
      return;
    }
    await updateFolderName(folderId, trimmed);
    if (icon !== folderIcon) {
      await updateFolderIcon(folderId, icon);
    }
    router.back();
  };

  const isCustomIcon = icon && !PRESET_ICONS.includes(icon);

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>Edit folder</Text>
      </View>
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          autoFocus
          selectTextOnFocus
          maxLength={40}
          returnKeyType="done"
          onSubmitEditing={handleSave}
          placeholderTextColor={Colors.textMuted}
        />
        <Text style={styles.label}>Icon</Text>
        <View style={styles.iconRow}>
          <View style={[styles.iconBtn, isCustomIcon && styles.iconBtnSelected, styles.iconPreview]}>
            <Text style={styles.iconEmoji}>{icon}</Text>
          </View>
          <TextInput
            style={[styles.input, styles.customInput]}
            value={customInput}
            onChangeText={handleCustomChange}
            placeholder="Custom emoji…"
            placeholderTextColor={Colors.textMuted}
            maxLength={8}
          />
        </View>
        <View style={styles.iconGrid}>
          {PRESET_ICONS.map((emoji) => (
            <Pressable
              key={emoji}
              style={[styles.iconBtn, icon === emoji && styles.iconBtnSelected]}
              onPress={() => handlePresetPress(emoji)}
            >
              <Text style={styles.iconEmoji}>{emoji}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.8 }]} onPress={handleSave}>
          <Text style={styles.saveBtnText}>Save</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  title: { ...Typography.subheading },
  body: { flex: 1 },
  bodyContent: { padding: Spacing.md, gap: Spacing.md },
  label: {
    ...Typography.caption,
    color: Colors.textSecondary,
    marginBottom: -Spacing.xs,
  },
  input: {
    height: 52,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    color: Colors.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  iconRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  iconPreview: {
    flexShrink: 0,
  },
  customInput: {
    flex: 1,
  },
  iconGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  iconBtn: {
    width: 52,
    height: 52,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtnSelected: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accentDim,
  },
  iconEmoji: {
    fontSize: 26,
  },
  saveBtn: {
    height: 52,
    backgroundColor: Colors.accent,
    borderRadius: Radius.full,
    alignItems: "center",
    justifyContent: "center",
    marginTop: Spacing.sm,
  },
  saveBtnText: { ...Typography.body, fontWeight: "700", color: Colors.white, fontSize: 16 },
});
