import { FlatList, RefreshControl, StyleSheet, useWindowDimensions, View, Text } from "react-native";
import React, { useCallback } from "react";
import { StashItem } from "../types";
import { Colors, Spacing, Typography } from "src/theme";
import ItemCard from "./ItemCard";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export const NUM_COLUMNS = 2;

export default function ItemGrid({
  items,
  onPress,
  onLongPress,
  onRefresh,
  refreshing,
  folderName,
}: {
  items: StashItem[];
  onPress: (item: StashItem) => void;
  onLongPress: (item: StashItem) => void;
  onRefresh: () => void;
  refreshing: boolean;
  folderName: string;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const cardWidth = (width - Spacing.md * 2 - Spacing.xs * 2 * NUM_COLUMNS) / NUM_COLUMNS;

  const renderItem = useCallback(
    ({ item }: { item: StashItem }) => (
      <ItemCard item={item} width={cardWidth} onPress={() => onPress(item)} onLongPress={() => onLongPress(item)} />
    ),
    [cardWidth, onPress, onLongPress],
  );

  return (
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
  );
}

const styles = StyleSheet.create({
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
