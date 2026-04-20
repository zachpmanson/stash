import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Alert, RefreshControl, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Spacing, Typography, Radius } from '../theme';
import { Folder, StashItem } from '../types';
import { getArchivedFolders, unarchiveFolder, deleteFolder } from '../db/folders';
import { getArchivedItems, unarchiveItem, deleteItem } from '../db/items';
import ItemCard from '../components/ItemCard';

export default function ArchiveScreen() {
  const [archivedFolders, setArchivedFolders] = useState<Folder[]>([]);
  const [archivedItems, setArchivedItems] = useState<StashItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const load = useCallback(async () => {
    const [fs, items] = await Promise.all([getArchivedFolders(), getArchivedItems()]);
    setArchivedFolders(fs);
    setArchivedItems(items);
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const handleFolderOptions = useCallback((folder: Folder) => {
    Alert.alert(folder.name, undefined, [
      {
        text: 'Unarchive',
        onPress: async () => { await unarchiveFolder(folder.id); load(); },
      },
      {
        text: 'Delete permanently',
        style: 'destructive',
        onPress: () => {
          Alert.alert('Delete folder?', 'This cannot be undone.', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: async () => { await deleteFolder(folder.id); load(); },
            },
          ]);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [load]);

  const handleItemOptions = useCallback((item: StashItem) => {
    Alert.alert('Item options', undefined, [
      {
        text: 'Unarchive',
        onPress: async () => { await unarchiveItem(item.id); load(); },
      },
      {
        text: 'Delete permanently',
        style: 'destructive',
        onPress: () => {
          Alert.alert('Delete item?', 'This cannot be undone.', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: async () => { await deleteItem(item.id); load(); },
            },
          ]);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [load]);

  const cardWidth = (width - Spacing.md * 2 - Spacing.xs * 4) / 2;

  const isEmpty = archivedFolders.length === 0 && archivedItems.length === 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Archive</Text>
      </View>

      {isEmpty ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🗃️</Text>
          <Text style={styles.emptyTitle}>Archive is empty</Text>
          <Text style={styles.emptyBody}>
            Long-press any folder or item to archive it.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xl }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />
          }
        >
          {archivedFolders.length > 0 && (
            <>
              <Text style={styles.sectionHeader}>Folders</Text>
              <View style={styles.folderList}>
                {archivedFolders.map(folder => (
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
                {archivedItems.map(item => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    width={cardWidth}
                    onPress={() => handleItemOptions(item)}
                    onLongPress={() => handleItemOptions(item)}
                  />
                ))}
              </View>
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
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
  folderList: { paddingHorizontal: Spacing.md },
  folderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  folderIcon: { fontSize: 24, marginRight: Spacing.md },
  folderInfo: { flex: 1 },
  folderName: { ...Typography.body, fontWeight: '600' },
  folderCount: { ...Typography.caption },
  folderAction: { ...Typography.body, color: Colors.textSecondary },
  itemGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: Spacing.md,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  emptyIcon: { fontSize: 56, marginBottom: Spacing.md },
  emptyTitle: { ...Typography.subheading, marginBottom: Spacing.sm },
  emptyBody: {
    ...Typography.body,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
});
