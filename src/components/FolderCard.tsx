import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Colors, Radius, Spacing, Typography } from "../theme";
import { Folder, SelectableFolder } from "../types";

interface Props {
  folder: SelectableFolder;
  onPress: (folder: Folder) => void;
  onLongPress?: (folder: Folder) => void;
}

const FOLDER_ICONS: Record<string, string> = {
  inbox: "📥",
};

function getIcon(name: string, id: string): string {
  if (FOLDER_ICONS[id]) return FOLDER_ICONS[id];
  const first = name.trim()[0]?.toLowerCase() ?? "📁";
  const emojiMap: Record<string, string> = {
    a: "🅰️",
    b: "📚",
    c: "💾",
    d: "📄",
    e: "✉️",
    f: "📁",
    g: "🎮",
    h: "🏠",
    i: "💡",
    j: "📓",
    k: "🔑",
    l: "🔗",
    m: "🎵",
    n: "📰",
    o: "🌐",
    p: "📌",
    q: "❓",
    r: "🔴",
    s: "⭐",
    t: "🏷️",
    u: "🔵",
    v: "🎬",
    w: "🌊",
    x: "❌",
    y: "💛",
    z: "⚡",
  };
  return emojiMap[first] ?? "📁";
}

export default function FolderCard({ folder, onPress, onLongPress }: Props) {
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.pressed, folder.isSelected && styles.selected]}
      onPress={() => onPress?.(folder)}
      onLongPress={() => onLongPress?.(folder)}
      android_ripple={{ color: Colors.accentDim }}
    >
      <View style={styles.iconWrap}>
        <Text style={styles.icon}>{folder.icon || getIcon(folder.name, folder.id)}</Text>
      </View>
      <Text style={styles.name} numberOfLines={2}>
        {folder.name}
      </Text>
      <Text style={styles.count}>{folder.item_count ?? 0} items</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    flex: 1,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    minHeight: 110,
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.75,
  },
  selected: {
    backgroundColor: Colors.accent,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface2,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.sm,
  },
  icon: {
    fontSize: 26,
  },
  name: {
    ...Typography.body,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 2,
  },
  count: {
    ...Typography.caption,
  },
});
