import IconButton from "@/components/IconButton";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { showModal } from "src/state/modalState";
import { useScrollTopState } from "src/state/scrollTopState";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { archiveFolder, createFolder, getFolders } from "../db/folders";
import { Colors, Radius, Spacing, Typography } from "../theme";
import { Folder } from "../types";
import { useFolderStore } from "src/state/folderState";
import FolderGrid from "src/components/FolderGrid";
import { isShareLaunch } from "src/utils/nativeShareIntent";
import AddItemFAB, { AddItemMode } from "src/components/AddItemFAB";
import AddItemModal from "src/components/AddItemModal";

export default function HomeScreen() {
  if (isShareLaunch()) {
    return <View style={{ flex: 1, backgroundColor: "transparent" }} />;
  }
  const router = useRouter();
  const [newFolderVisible, setNewFolderVisible] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [addItemMode, setAddItemMode] = useState<AddItemMode | null>(null);
  const inputRef = useRef<TextInput>(null);
  const gridRef = useRef<FlatList>(null);
  const insets = useSafeAreaInsets();
  const { refresh } = useFolderStore();
  const setScrollTopHandler = useScrollTopState((s) => s.setHandler);

  useFocusEffect(
    useCallback(() => {
      setScrollTopHandler(() => gridRef.current?.scrollToOffset({ offset: 0, animated: true }));
      return () => setScrollTopHandler(null);
    }, [setScrollTopHandler]),
  );

  const handleNewFolder = useCallback(() => {
    setNewFolderName("");
    setNewFolderVisible(true);
  }, []);

  const handleNewFolderSubmit = useCallback(async () => {
    const name = newFolderName.trim();
    if (name) {
      await createFolder(String(Date.now()), name);
      refresh();
    }
    setNewFolderVisible(false);
  }, [newFolderName, refresh]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Modal
        visible={newFolderVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setNewFolderVisible(false)}
      >
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "padding"}>
          <Pressable style={styles.overlay} onPress={() => setNewFolderVisible(false)}>
            <Pressable style={styles.dialog} onPress={() => {}}>
              <Text style={styles.dialogTitle}>New Folder</Text>
              <Text style={styles.dialogBody}>Enter a name for your new folder</Text>
              <TextInput
                ref={inputRef}
                style={styles.input}
                value={newFolderName}
                onChangeText={setNewFolderName}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={handleNewFolderSubmit}
                placeholderTextColor={Colors.textMuted}
                placeholder="Folder name"
                selectionColor={Colors.accent}
              />
              <View style={styles.dialogActions}>
                <Pressable onPress={() => setNewFolderVisible(false)} style={styles.dialogBtn}>
                  <Text style={styles.dialogBtnText}>Cancel</Text>
                </Pressable>
                <Pressable onPress={handleNewFolderSubmit} style={[styles.dialogBtn, styles.dialogBtnPrimary]}>
                  <Text style={[styles.dialogBtnText, styles.dialogBtnTextPrimary]}>Create</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
      <Pressable
        style={styles.header}
        onPress={() => gridRef.current?.scrollToOffset({ offset: 0, animated: true })}
      >
        <Text style={styles.title}>Stash</Text>
        <View style={styles.headerActions}>
          <IconButton onPress={() => router.push("/settings")}>⚙️</IconButton>
          <IconButton onPress={() => router.push("/archive")}>🗃️</IconButton>
        </View>
      </Pressable>
      <View style={[styles.gridContainer]}>
        <FolderGrid
          ref={gridRef}
          onFolderPress={(item) =>
            router.push({
              pathname: "/folder/[id]",
              params: { id: item.id, folderName: item.name, folderIcon: item.icon },
            })
          }
        />
      </View>
      <AddItemFAB onSelect={setAddItemMode} onNewFolder={handleNewFolder} />
      <AddItemModal visible={addItemMode !== null} mode={addItemMode} onClose={() => setAddItemMode(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  gridContainer: {
    paddingHorizontal: Spacing.xs,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  title: {
    ...Typography.heading,
    fontSize: 28,
    letterSpacing: -0.5,
  },
  headerActions: {
    flexDirection: "row",
    gap: Spacing.sm,
    alignItems: "center",
  },

  addBtn: {
    backgroundColor: Colors.accent,
  },
  addBtnText: {
    color: Colors.white,
    fontSize: 24,
    fontWeight: "300",
    lineHeight: 28,
  },

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
});
