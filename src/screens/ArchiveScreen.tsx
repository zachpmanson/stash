import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  useWindowDimensions,
  Modal,
  KeyboardAvoidingView,
  Platform,
  TextInput,
} from "react-native";
import { showModal } from "src/state/modalState";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors, Spacing, Typography, Radius } from "../theme";
import { Folder, StashItem } from "../types";
import { getArchivedFolders, unarchiveFolder, deleteFolder } from "../db/folders";
import { getArchivedItems, unarchiveItem, updateItemTitle, deleteItem } from "../db/items";
import ItemCard from "../components/ItemCard";
import Screen from "../components/Screen";
import ItemGrid from "src/components/ItemGrid";

export default function ArchiveScreen() {
  const [archivedFolders, setArchivedFolders] = useState<Folder[]>([]);
  const [archivedItems, setArchivedItems] = useState<StashItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [unarchivingItem, setUnarchivingItem] = useState<StashItem | null>(null);
  const [unarchiveTitle, setUnarchiveTitle] = useState("");
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const titleInputRef = useRef<TextInput>(null);

  const load = useCallback(async () => {
    const [fs, items] = await Promise.all([getArchivedFolders(), getArchivedItems()]);
    setArchivedFolders(fs);
    setArchivedItems(items);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const handleFolderOptions = useCallback(
    (folder: Folder) => {
      showModal({
        title: folder.name,
        buttons: [
          { text: "Cancel", style: "cancel" },
          {
            text: "Unarchive",
            onPress: async () => {
              await unarchiveFolder(folder.id);
              load();
            },
          },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              showModal({
                title: "Delete folder?",
                message: "This cannot be undone.",
                buttons: [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Delete",
                    style: "destructive",
                    onPress: async () => {
                      await deleteFolder(folder.id);
                      load();
                    },
                  },
                ],
              });
            },
          },
        ],
      });
    },
    [load],
  );

  const handleUnarchiveSubmit = useCallback(async () => {
    if (!unarchivingItem) return;
    const trimmed = unarchiveTitle.trim();
    if (trimmed !== (unarchivingItem.title ?? "").trim()) {
      await updateItemTitle(unarchivingItem.id, trimmed || null);
    }
    await unarchiveItem(unarchivingItem.id);
    setUnarchivingItem(null);
    load();
  }, [unarchivingItem, unarchiveTitle, load]);

  const handleItemOptions = useCallback(
    (item: StashItem) => {
      showModal({
        title: "Item options",
        buttons: [
          { text: "Cancel", style: "cancel" },
          {
            text: "Unarchive",
            onPress: () => {
              setUnarchiveTitle(item.title ?? "");
              setUnarchivingItem(item);
            },
          },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              showModal({
                title: "Delete item?",
                message: "This cannot be undone.",
                buttons: [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Delete",
                    style: "destructive",
                    onPress: async () => {
                      await deleteItem(item.id);
                      load();
                    },
                  },
                ],
              });
            },
          },
        ],
      });
    },
    [load],
  );

  const isEmpty = archivedFolders.length === 0 && archivedItems.length === 0;

  return (
    <Screen>
      <Modal
        visible={unarchivingItem !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setUnarchivingItem(null)}
      >
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "padding"}>
          <Pressable style={styles.overlay} onPress={() => setUnarchivingItem(null)}>
            <Pressable style={styles.dialog} onPress={() => {}}>
              <Text style={styles.dialogTitle}>Unarchive item</Text>
              <Text style={styles.dialogBody}>Update the title before restoring it, or leave it as-is.</Text>
              <TextInput
                ref={titleInputRef}
                style={styles.input}
                value={unarchiveTitle}
                onChangeText={setUnarchiveTitle}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={handleUnarchiveSubmit}
                placeholderTextColor={Colors.textMuted}
                placeholder="Title"
                selectionColor={Colors.accent}
              />
              <View style={styles.dialogActions}>
                <Pressable onPress={() => setUnarchivingItem(null)} style={styles.dialogBtn}>
                  <Text style={styles.dialogBtnText}>Cancel</Text>
                </Pressable>
                <Pressable onPress={handleUnarchiveSubmit} style={[styles.dialogBtn, styles.dialogBtnPrimary]}>
                  <Text style={[styles.dialogBtnText, styles.dialogBtnTextPrimary]}>Unarchive</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
      {isEmpty ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🗃️</Text>
          <Text style={styles.emptyTitle}>Archive is empty</Text>
          <Text style={styles.emptyBody}>Long-press any folder or item to archive it.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}
        >
          {archivedFolders.length > 0 && (
            <>
              <Text style={styles.sectionHeader}>Folders</Text>
              <View style={styles.folderList}>
                {archivedFolders.map((folder) => (
                  <Pressable
                    key={folder.id}
                    style={styles.folderRow}
                    onLongPress={() => handleFolderOptions(folder)}
                    onPress={() => handleFolderOptions(folder)}
                  >
                    <Text style={styles.folderIcon}>📁</Text>
                    <View style={styles.folderInfo}>
                      <Text style={styles.folderName}>{folder.name}</Text>
                      <Text style={styles.folderCount}>{folder.item_count ?? 0} items</Text>
                    </View>
                    <Text style={styles.folderAction}>···</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
          {archivedItems.length > 0 && (
            <>
              <Text style={styles.sectionHeader}>Items</Text>
              <View style={styles.itemGrid}>
                <ItemGrid
                  items={archivedItems}
                  onPress={(item) => handleItemOptions(item)}
                  onLongPress={(item) => handleItemOptions(item)}
                  folderName="Archive"
                  refreshing={refreshing}
                  onRefresh={onRefresh}
                />
              </View>
            </>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: Colors.bg },
  overlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.xl,
  },
  dialog: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    width: "100%",
  },
  dialogTitle: {
    ...Typography.subheading,
    marginBottom: Spacing.xs,
  },
  dialogBody: {
    ...Typography.body,
    color: Colors.textSecondary,
    marginBottom: Spacing.md,
  },
  input: {
    backgroundColor: Colors.surface2,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    color: Colors.text,
    fontSize: 16,
    marginBottom: Spacing.lg,
  },
  dialogActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: Spacing.sm,
  },
  dialogBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.sm,
  },
  dialogBtnPrimary: {
    backgroundColor: Colors.accent,
  },
  dialogBtnText: {
    ...Typography.body,
    color: Colors.textSecondary,
    fontWeight: "600",
  },
  dialogBtnTextPrimary: {
    color: Colors.white,
  },
  header: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  title: { ...Typography.heading, fontSize: 28, letterSpacing: -0.5 },
  sectionHeader: {
    ...Typography.label,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  folderList: { paddingHorizontal: Spacing.sm },
  folderRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  folderIcon: { fontSize: 24, marginRight: Spacing.md },
  folderInfo: { flex: 1 },
  folderName: { ...Typography.body, fontWeight: "600" },
  folderCount: { ...Typography.caption },
  folderAction: { ...Typography.body, color: Colors.textSecondary },
  itemGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: Spacing.sm,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xl,
  },
  emptyIcon: { fontSize: 56, marginBottom: Spacing.md },
  emptyTitle: { ...Typography.subheading, marginBottom: Spacing.sm },
  emptyBody: {
    ...Typography.body,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
});
