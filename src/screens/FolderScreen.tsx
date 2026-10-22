import { MaterialIcons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, StyleSheet, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ItemGrid from "src/components/ItemGrid";
import FolderMap from "src/components/FolderMap";
import AddItemFAB, { AddItemMode } from "src/components/AddItemFAB";
import AddItemModal from "src/components/AddItemModal";
import { showModal } from "src/state/modalState";
import { useScrollTopState } from "src/state/scrollTopState";
import Screen from "../components/Screen";
import TopbarButton from "../components/TopbarButton";
import OverflowMenu from "../components/OverflowMenu";
import { archiveFolder, getFolderById } from "../db/folders";
import { archiveItem, getItemsInFolder } from "../db/items";
import { subscribeStashSyncStatus, type StashSyncStatus } from "../db/syncClient";
import { STASH_SYNC_DEV_TOOLS } from "../utils/syncBuildGate";
import { Colors, Spacing, Typography } from "../theme";
import { FolderLayout, StashItem } from "../types";

export default function FolderScreen() {
  const {
    id: folderId,
    folderName,
    folderIcon,
  } = useLocalSearchParams<{ id: string; folderName: string; folderIcon?: string }>();
  const router = useRouter();
  const [items, setItems] = useState<StashItem[]>([]);
  const [layout, setLayout] = useState<FolderLayout>("grid");
  const [showMap, setShowMap] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [addItemMode, setAddItemMode] = useState<AddItemMode | null>(null);
  const [sync, setSync] = useState<StashSyncStatus | null>(null);

  useEffect(() => {
    if (!STASH_SYNC_DEV_TOOLS) return;
    return subscribeStashSyncStatus(setSync);
  }, []);

  // An established account may still be syncing/offline. The feed view alone
  // confirms availability after a full exchange and a validated backend response.
  const showFeed = STASH_SYNC_DEV_TOOLS && !!sync?.account &&
    (sync.phase === "synced" || sync.phase === "syncing" || sync.phase === "error") &&
    !sync.disconnecting && !sync.restartRequired && !sync.authenticationRequired;
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList>(null);
  const setScrollTopHandler = useScrollTopState((s) => s.setHandler);

  const loadItems = useCallback(async () => {
    const data = await getItemsInFolder(folderId);
    setItems(data);
  }, [folderId]);

  const hasGpsItems = items.some((i) => i.lat != null && i.lng != null);

  useFocusEffect(
    useCallback(() => {
      loadItems();
      getFolderById(folderId).then((f) => {
        if (f?.layout) setLayout(f.layout);
      });
      setScrollTopHandler(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }));
      return () => setScrollTopHandler(null);
    }, [loadItems, folderId, setScrollTopHandler]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadItems();
    setRefreshing(false);
  }, [loadItems]);

  const handleLongPress = useCallback(
    (item: StashItem) => {
      showModal({
        title: "Item options",
        buttons: [
          { text: "Cancel", style: "cancel" },
          {
            text: "Move...",
            onPress: () => router.push({ pathname: "/move-item/[id]", params: { id: item.id } }),
          },
          {
            text: "Archive",
            style: "destructive",
            onPress: async () => {
              await archiveItem(item.id);
              await loadItems();
            },
          },
        ],
      });
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
    showModal({
      title: "Archive folder?",
      message: `"${folderName}" will be moved to the archive.`,
      buttons: [
        { text: "Cancel", style: "cancel" },
        {
          text: "Archive",
          style: "destructive",
          onPress: async () => {
            await archiveFolder(folderId);
            router.back();
          },
        },
      ],
    });
  }, [folderId, folderName, router]);

  return (
    <Screen
      title={folderName}
      buttons={
        <>
          {hasGpsItems && (
            <TopbarButton onPress={() => setShowMap((v) => !v)}>
              <MaterialIcons name={showMap ? "grid-view" : "map"} size={20} color={Colors.text} />
            </TopbarButton>
          )}
          <TopbarButton onPress={handleEdit}>
            <MaterialIcons name="edit" size={20} color={Colors.text} />
          </TopbarButton>
          <OverflowMenu
            // Only ephemeral menu state resets when its folder/account changes.
            key={JSON.stringify([folderId, showFeed, sync?.account?.serverUrl, sync?.account?.username])}
            accessibilityLabel="Folder actions"
            items={[
              ...(showFeed ? [{
                title: "Atom feed",
                onPress: () => router.push({ pathname: "/folder-feed/[id]", params: { id: folderId } }),
              }] : []),
              { title: "Archive", destructive: true, onPress: handleArchive },
            ]}
          />
        </>
      }
    >
      {showMap ? (
        <FolderMap items={items} folderName={folderName} />
      ) : (
        <ItemGrid
          ref={listRef}
          items={items}
          onPress={(item) => router.push({ pathname: "/item/[id]", params: { id: item.id } })}
          onLongPress={(item) => handleLongPress(item)}
          onRefresh={onRefresh}
          refreshing={refreshing}
          folderName={folderName}
          numColumns={layout === "list" ? 1 : 2}
        />
      )}
      <AddItemFAB onSelect={setAddItemMode} />
      <AddItemModal
        visible={addItemMode !== null}
        mode={addItemMode}
        onClose={() => setAddItemMode(null)}
        initialFolderId={folderId}
        onSaved={loadItems}
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
  emptyIcon: { fontSize: 56, marginBottom: Spacing.md },
  emptyTitle: { ...Typography.subheading, marginBottom: Spacing.sm },
  emptyBody: {
    ...Typography.body,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
});
