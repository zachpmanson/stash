import { FlatList, RefreshControl, StyleSheet, View, Text } from "react-native";
import React, { useCallback, useMemo } from "react";
import { StashItem } from "../types";
import { Colors, Spacing, Typography } from "src/theme";
import ItemCard from "./ItemCard";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export const NUM_COLUMNS = 2;

const SHADOW_ITEM_ID = "__shadow__";
type GridItem = StashItem | { id: typeof SHADOW_ITEM_ID };

const ItemGrid = React.forwardRef<FlatList<GridItem>, {
  items: StashItem[];
  onPress: (item: StashItem) => void;
  onLongPress: (item: StashItem) => void;
  onRefresh: () => void;
  refreshing: boolean;
  folderName: string;
  numColumns?: number;
}>(function ItemGrid({ items, onPress, onLongPress, onRefresh, refreshing, folderName, numColumns = NUM_COLUMNS }, ref) {
  const insets = useSafeAreaInsets();

  const renderItem = useCallback(
    ({ item }: { item: GridItem }) => {
      if (item.id === SHADOW_ITEM_ID) {
        return <View style={[styles.cell]} />;
      }
      const stashItem = item as StashItem;
      return (
        <View style={styles.cell}>
          <ItemCard
            item={stashItem}
            onPress={() => onPress(stashItem)}
            onLongPress={() => onLongPress(stashItem)}
            fullWidth={numColumns === 1}
          />
        </View>
      );
    },
    [onPress, onLongPress, numColumns],
  );

  const data = useMemo<GridItem[]>(
    () => (items.length % numColumns === 0 ? items : [...items, { id: SHADOW_ITEM_ID }]),
    [items, numColumns],
  );

  return (
    <FlatList
      // key forces FlatList to remount when column count changes, since numColumns can't change on the fly
      key={numColumns}
      ref={ref}
      data={data}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      numColumns={numColumns}
      columnWrapperStyle={numColumns > 1 ? styles.row : undefined}
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
});

export default ItemGrid;

const styles = StyleSheet.create({
  grid: {
    paddingHorizontal: Spacing.sm,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
  },
  row: {
    gap: Spacing.sm,
  },
  cell: {
    flex: 1,
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
