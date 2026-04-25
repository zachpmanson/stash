import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable,
} from 'react-native';
import { showModal } from 'src/state/modalState';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Colors, Spacing, Typography, Radius } from '../theme';
import { Folder } from '../types';
import { getFolders } from '../db/folders';
import { getItemById, addItemToFolder, removeItemFromFolder } from '../db/items';
import Screen from '../components/Screen';

export default function MoveItemScreen() {
  const { id: itemId } = useLocalSearchParams<{ id: string }>();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [currentFolderIds, setCurrentFolderIds] = useState<Set<string>>(new Set());
  const insets = useSafeAreaInsets();

  useEffect(() => {
    (async () => {
      const [fs, item] = await Promise.all([getFolders(), getItemById(itemId)]);
      setFolders(fs);
      setCurrentFolderIds(new Set(item?.folder_ids ?? []));
    })();
  }, [itemId]);

  const toggleFolder = useCallback(async (folderId: string) => {
    const isIn = currentFolderIds.has(folderId);
    if (isIn && currentFolderIds.size === 1) {
      showModal({ title: 'Cannot remove', message: 'Item must be in at least one folder.' });
      return;
    }
    if (isIn) {
      await removeItemFromFolder(itemId, folderId);
      setCurrentFolderIds(prev => { const s = new Set(prev); s.delete(folderId); return s; });
    } else {
      await addItemToFolder(itemId, folderId);
      setCurrentFolderIds(prev => new Set([...prev, folderId]));
    }
  }, [itemId, currentFolderIds]);

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>Add to folders</Text>
      </View>
      <FlatList
        data={folders}
        keyExtractor={item => item.id}
        renderItem={({ item: folder }) => {
          const checked = currentFolderIds.has(folder.id);
          return (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => toggleFolder(folder.id)}
            >
              <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                {checked && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={styles.folderName}>{folder.name}</Text>
            </Pressable>
          );
        }}
        contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xl }}
      />
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rowPressed: { backgroundColor: Colors.surface },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  checkboxChecked: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  checkmark: { color: Colors.white, fontSize: 14, fontWeight: '700' },
  folderName: { ...Typography.body },
});
