import { Alert, FlatList, Modal, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import FolderCard from "../components/FolderCard";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Folder } from "../types";
import { useFocusEffect, useRouter } from "expo-router";
import { Colors, Spacing, Typography } from "../theme";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFolderStore } from "src/state/folderState";

const NUM_COLUMNS = 2;

const SHADOW_FOLDER_ID = "__shadow__";
type GridFolder = Folder | { id: typeof SHADOW_FOLDER_ID };

export default function FolderGrid({
  onFolderPress,
  onFolderLongPress,
  selectedIds,
}: {
  onFolderPress: (folder: Folder) => void;
  onFolderLongPress?: (folder: Folder) => void;
  selectedIds?: Set<string>;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { folders, refresh } = useFolderStore();

  const [refreshing, setRefreshing] = useState(false);

  const renderFolder = useCallback(
    ({ item }: { item: GridFolder }) => {
      if (item.id === SHADOW_FOLDER_ID) {
        return <View style={styles.shadow} />;
      }
      const folder = item as Folder;
      return (
        <FolderCard
          folder={{ ...folder, isSelected: selectedIds?.has(folder.id) ?? false }}
          onPress={(f) => {
            onFolderPress(f);
          }}
          onLongPress={(f) => {
            onFolderLongPress?.(f);
          }}
        />
      );
    },
    [onFolderPress, onFolderLongPress, selectedIds],
  );

  const data = useMemo<GridFolder[]>(
    () => (folders.length % NUM_COLUMNS === 0 ? folders : [...folders, { id: SHADOW_FOLDER_ID }]),
    [folders],
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  return (
    <FlatList
      data={data}
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
  );
}

const styles = StyleSheet.create({
  grid: {
    // paddingHorizontal: Spacing.md,
    paddingTop: Spacing.xs,
  },
  shadow: {
    flex: 1,
    margin: Spacing.xs,
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
});
