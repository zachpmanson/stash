import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, Alert, RefreshControl,
  useWindowDimensions, FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect, Stack } from 'expo-router';
import { Colors, Spacing, Typography } from '../theme';
import { StashItem } from '../types';
import { getItemsInFolder, archiveItem } from '../db/items';
import ItemCard from '../components/ItemCard';

const NUM_COLUMNS = 2;

export default function FolderScreen() {
  const { id: folderId, folderName } = useLocalSearchParams<{ id: string; folderName: string }>();
  const router = useRouter();
  const [items, setItems] = useState<StashItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const loadItems = useCallback(async () => {
    const data = await getItemsInFolder(folderId);
    setItems(data);
  }, [folderId]);

  useFocusEffect(useCallback(() => {
    loadItems();
  }, [loadItems]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadItems();
    setRefreshing(false);
  }, [loadItems]);

  const handleLongPress = useCallback((item: StashItem) => {
    Alert.alert('Item options', undefined, [
      {
        text: 'Archive',
        style: 'destructive',
        onPress: async () => {
          await archiveItem(item.id);
          loadItems();
        },
      },
      {
        text: 'Move to folder…',
        onPress: () => router.push({ pathname: '/move-item/[id]', params: { id: item.id } }),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [router, loadItems]);

  const cardWidth = (width - Spacing.md * 2 - Spacing.xs * 2 * NUM_COLUMNS) / NUM_COLUMNS;

  const renderItem = useCallback(({ item }: { item: StashItem }) => (
    <ItemCard
      item={item}
      width={cardWidth}
      onPress={() => router.push({ pathname: '/item/[id]', params: { id: item.id } })}
      onLongPress={() => handleLongPress(item)}
    />
  ), [cardWidth, router, handleLongPress]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ title: folderName }} />
      <FlatList
        data={items}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        numColumns={NUM_COLUMNS}
        contentContainerStyle={[
          styles.grid,
          { paddingBottom: insets.bottom + Spacing.xl },
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🗂️</Text>
            <Text style={styles.emptyTitle}>Nothing here yet</Text>
            <Text style={styles.emptyBody}>
              Share something to {folderName} from any app.
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
  grid: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
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
