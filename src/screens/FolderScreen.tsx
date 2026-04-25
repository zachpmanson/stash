import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Alert, RefreshControl, useWindowDimensions, FlatList } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Colors, Spacing, Typography } from "../theme";
import { StashItem } from "../types";
import { getItemsInFolder, archiveItem } from "../db/items";
import { archiveFolder } from "../db/folders";
import ItemCard from "../components/ItemCard";
import TopbarButton from "../components/TopbarButton";
import Screen from "../components/Screen";
import { MaterialIcons } from "@expo/vector-icons";

const NUM_COLUMNS = 2;

export default function FolderScreen() {
  const {
    id: folderId,
    folderName,
    folderIcon,
  } = useLocalSearchParams<{ id: string; folderName: string; folderIcon?: string }>();
  const router = useRouter();
  const [items, setItems] = useState<StashItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const loadItems = useCallback(async () => {
    const data = await getItemsInFolder(folderId);
    setItems(data);
  }, [folderId]);

  useFocusEffect(
    useCallback(() => {
      loadItems();
    }, [loadItems]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadItems();
    setRefreshing(false);
  }, [loadItems]);

  const handleLongPress = useCallback(
    (item: StashItem) => {
      Alert.alert("Item options", undefined, [
        {
          text: "Archive",
          style: "destructive",
          onPress: async () => {
            await archiveItem(item.id);
            loadItems();
          },
        },
        {
          text: "Move to folder…",
          onPress: () => router.push({ pathname: "/move-item/[id]", params: { id: item.id } }),
        },
        { text: "Cancel", style: "cancel" },
      ]);
    },
    [router, loadItems],
  );

  const handleEdit = useCallback(() => {
    router.push({
      pathname: "/edit-folder/[id]",
      params: { id: folderId, folderName, folderIcon },
    });
  }, [router, folderId, folderName, folderIcon]);

  const handleArchive = useCallback(() => {
    Alert.alert("Archive folder?", `"${folderName}" will be moved to the archive.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Archive",
        style: "destructive",
        onPress: async () => {
          await archiveFolder(folderId);
          router.back();
        },
      },
    ]);
  }, [folderId, folderName, router]);

  const cardWidth = (width - Spacing.md * 2 - Spacing.xs * 2 * NUM_COLUMNS) / NUM_COLUMNS;

  const renderItem = useCallback(
    ({ item }: { item: StashItem }) => (
      <ItemCard
        item={item}
        width={cardWidth}
        onPress={() => router.push({ pathname: "/item/[id]", params: { id: item.id } })}
        onLongPress={() => handleLongPress(item)}
      />
    ),
    [cardWidth, router, handleLongPress],
  );

  return (
    <Screen
      options={{
        title: folderName,
        headerRight: () => (
          <View style={styles.headerActions}>
            <TopbarButton onPress={handleEdit}>
              <MaterialIcons name="edit" size={20} color={Colors.text} />
            </TopbarButton>
            <TopbarButton onPress={handleArchive}>
              <MaterialIcons name="archive" size={20} color={Colors.text} />
            </TopbarButton>
          </View>
        ),
      }}
    >
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        numColumns={NUM_COLUMNS}
        contentContainerStyle={[styles.grid, { paddingBottom: insets.bottom + Spacing.xl }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🗂️</Text>
            <Text style={styles.emptyTitle}>Nothing here yet</Text>
            <Text style={styles.emptyBody}>Share something to {folderName} from any app.</Text>
          </View>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  grid: {
    paddingHorizontal: Spacing.sm,
    paddingTop: Spacing.sm,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
    paddingHorizontal: Spacing.xl,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
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
