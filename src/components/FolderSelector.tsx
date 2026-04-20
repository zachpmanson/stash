import React, { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { createFolder } from "../db/folders";
import { Colors, Radius, Spacing, Typography } from "../theme";
import { Folder } from "../types";

interface Props {
  folders: Folder[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onFolderCreated: (folder: Folder) => void;
}

export default function FolderSelector({ folders, selectedIds, onToggle, onFolderCreated }: Props) {
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const folder = await createFolder(String(Date.now()), name);
      onFolderCreated(folder);
      setNewName("");
    } finally {
      setCreating(false);
    }
  }, [newName, onFolderCreated]);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Save to</Text>
      <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
        {folders.map((folder) => {
          const checked = selectedIds.has(folder.id);
          return (
            <Pressable
              key={folder.id}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => onToggle(folder.id)}
            >
              <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                {checked && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={styles.folderName} numberOfLines={1}>
                {folder.name}
              </Text>
              {folder.item_count !== undefined && <Text style={styles.folderCount}>{folder.item_count}</Text>}
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.newFolderRow}>
        <TextInput
          style={styles.input}
          value={newName}
          onChangeText={setNewName}
          placeholder="New folder name…"
          placeholderTextColor={Colors.textMuted}
          returnKeyType="done"
          onSubmitEditing={handleCreate}
          maxLength={40}
        />
        <Pressable
          style={({ pressed }) => [
            styles.createBtn,
            !newName.trim() && styles.createBtnDisabled,
            pressed && styles.createBtnPressed,
          ]}
          onPress={handleCreate}
          disabled={!newName.trim() || creating}
        >
          {creating ? (
            <ActivityIndicator size="small" color={Colors.text} />
          ) : (
            <Text style={styles.createBtnText}>+</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  label: {
    ...Typography.label,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  list: {
    maxHeight: 240,
    paddingHorizontal: Spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.md,
  },
  rowPressed: {
    backgroundColor: Colors.surface2,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.sm,
  },
  checkboxChecked: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  checkmark: {
    color: Colors.white,
    fontSize: 14,
    fontWeight: "700",
  },
  folderName: {
    ...Typography.body,
    flex: 1,
  },
  folderCount: {
    ...Typography.caption,
    marginLeft: Spacing.sm,
  },
  newFolderRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    marginTop: Spacing.xs,
  },
  input: {
    flex: 1,
    height: 44,
    backgroundColor: Colors.surface2,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    color: Colors.text,
    fontSize: 15,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  createBtn: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  createBtnDisabled: {
    backgroundColor: Colors.surface3,
  },
  createBtnPressed: {
    opacity: 0.8,
  },
  createBtnText: {
    color: Colors.white,
    fontSize: 22,
    fontWeight: "300",
    lineHeight: 26,
  },
});
