import IconButton from "@/components/IconButton";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import FolderCard from "../components/FolderCard";
import { archiveFolder, createFolder, getFolders } from "../db/folders";
import { RootStackParamList } from "../navigation/types";
import { Colors, Radius, Spacing, Typography } from "../theme";
import { Folder } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

const NUM_COLUMNS = 2;

export default function HomeScreen({ navigation }: Props) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [newFolderVisible, setNewFolderVisible] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const inputRef = useRef<TextInput>(null);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const loadFolders = useCallback(async () => {
    const fs = await getFolders();
    setFolders(fs);
  }, []);

  useEffect(() => {
    const unsub = navigation.addListener("focus", loadFolders);
    return unsub;
  }, [navigation, loadFolders]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadFolders();
    setRefreshing(false);
  }, [loadFolders]);

  const handleLongPress = useCallback(
    (folder: Folder) => {
      Alert.alert(folder.name, undefined, [
        {
          text: "Rename",
          onPress: () => navigation.navigate("EditFolder", { folderId: folder.id, folderName: folder.name }),
        },
        {
          text: "Archive",
          style: "destructive",
          onPress: async () => {
            await archiveFolder(folder.id);
            loadFolders();
          },
        },
        { text: "Cancel", style: "cancel" },
      ]);
    },
    [navigation, loadFolders],
  );

  const handleNewFolder = useCallback(() => {
    setNewFolderName("");
    setNewFolderVisible(true);
  }, []);

  const handleNewFolderSubmit = useCallback(async () => {
    const name = newFolderName.trim();
    if (name) {
      await createFolder(String(Date.now()), name);
      loadFolders();
    }
    setNewFolderVisible(false);
  }, [newFolderName, loadFolders]);

  const cardWidth = (width - Spacing.md * 2 - Spacing.xs * 2 * NUM_COLUMNS) / NUM_COLUMNS;

  const renderFolder = useCallback(
    ({ item }: { item: Folder }) => (
      <FolderCard
        folder={item}
        onPress={() => navigation.navigate("Folder", { folderId: item.id, folderName: item.name })}
        onLongPress={() => handleLongPress(item)}
      />
    ),
    [navigation, handleLongPress],
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Modal
        visible={newFolderVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setNewFolderVisible(false)}
      >
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
      </Modal>
      <View style={styles.header}>
        <Text style={styles.title}>Stash</Text>
        <View style={styles.headerActions}>
          <IconButton onPress={() => navigation.navigate("Archive")}>🗃️</IconButton>
          <IconButton style={[styles.addBtn]} onPress={handleNewFolder}>
            <Text style={styles.addBtnText}>+</Text>
          </IconButton>
        </View>
      </View>

      <FlatList
        data={folders}
        keyExtractor={(item) => item.id}
        renderItem={renderFolder}
        numColumns={NUM_COLUMNS}
        contentContainerStyle={[styles.grid, { paddingBottom: insets.bottom + Spacing.xl }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📦</Text>
            <Text style={styles.emptyTitle}>No folders yet</Text>
            <Text style={styles.emptyBody}>
              Share anything from another app to save it here, or tap + to create a folder.
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
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
  grid: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.xs,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
    paddingHorizontal: Spacing.xl,
  },
  emptyIcon: {
    fontSize: 56,
    marginBottom: Spacing.md,
  },
  emptyTitle: {
    ...Typography.subheading,
    marginBottom: Spacing.sm,
  },
  emptyBody: {
    ...Typography.body,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
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
