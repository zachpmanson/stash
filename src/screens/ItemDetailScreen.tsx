import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Linking, Alert, Share, Image,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Colors, Spacing, Typography, Radius } from '../theme';
import { StashItem } from '../types';
import { getItemById, archiveItem } from '../db/items';
import { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'ItemDetail'>;

export default function ItemDetailScreen({ route, navigation }: Props) {
  const { itemId } = route.params;
  const [item, setItem] = useState<StashItem | null>(null);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    getItemById(itemId).then(setItem);
  }, [itemId]);

  const handleOpen = useCallback(() => {
    if (!item) return;
    if (item.type === 'url') {
      Linking.openURL(item.uri).catch(() =>
        Alert.alert('Cannot open URL', item.uri)
      );
    }
  }, [item]);

  const handleCopy = useCallback(async () => {
    if (!item) return;
    await Clipboard.setStringAsync(item.uri);
    Alert.alert('Copied', 'Link copied to clipboard');
  }, [item]);

  const handleShare = useCallback(async () => {
    if (!item) return;
    await Share.share({ url: item.type === 'image' ? item.uri : undefined, message: item.uri });
  }, [item]);

  const handleArchive = useCallback(() => {
    if (!item) return;
    Alert.alert('Archive item?', 'You can unarchive it later.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Archive',
        style: 'destructive',
        onPress: async () => {
          await archiveItem(item.id);
          navigation.goBack();
        },
      },
    ]);
  }, [item, navigation]);

  if (!item) return null;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xl }}>
        {/* Media preview */}
        {item.type === 'image' && (
          <Image
            source={{ uri: item.uri }}
            style={styles.fullImage}
            resizeMode="contain"
          />
        )}

        {item.type === 'url' && item.thumbnail_path && (
          <Image
            source={{ uri: item.thumbnail_path }}
            style={styles.ogImage}
            resizeMode="cover"
          />
        )}

        <View style={styles.body}>
          {/* Title / URL */}
          {item.title ? (
            <Text style={styles.title}>{item.title}</Text>
          ) : null}

          {item.type === 'url' && (
            <Pressable onPress={handleOpen}>
              <Text style={styles.url} numberOfLines={3}>{item.uri}</Text>
            </Pressable>
          )}

          {item.type === 'text' && (
            <Text style={styles.textContent} selectable>{item.uri}</Text>
          )}

          {item.description ? (
            <Text style={styles.description}>{item.description}</Text>
          ) : null}

          <Text style={styles.meta}>
            Saved {new Date(item.created_at).toLocaleString()}
          </Text>

          {/* Actions */}
          <View style={styles.actions}>
            {item.type === 'url' && (
              <>
                <ActionButton label="Open" icon="🌐" onPress={handleOpen} />
                <ActionButton label="Copy" icon="📋" onPress={handleCopy} />
              </>
            )}
            <ActionButton label="Share" icon="↗️" onPress={handleShare} />
            <ActionButton label="Archive" icon="🗃️" onPress={handleArchive} danger />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function ActionButton({
  label, icon, onPress, danger,
}: {
  label: string;
  icon: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.actionBtn, danger && styles.actionBtnDanger, pressed && styles.actionBtnPressed]}
      onPress={onPress}
    >
      <Text style={styles.actionIcon}>{icon}</Text>
      <Text style={[styles.actionLabel, danger && styles.actionLabelDanger]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  fullImage: {
    width: '100%',
    height: 320,
    backgroundColor: Colors.surface2,
  },
  ogImage: {
    width: '100%',
    height: 220,
    backgroundColor: Colors.surface2,
  },
  body: {
    padding: Spacing.md,
  },
  title: {
    ...Typography.subheading,
    marginBottom: Spacing.sm,
    lineHeight: 26,
  },
  url: {
    color: Colors.accent,
    fontSize: 14,
    marginBottom: Spacing.md,
    lineHeight: 20,
  },
  textContent: {
    ...Typography.body,
    lineHeight: 24,
    marginBottom: Spacing.md,
  },
  description: {
    ...Typography.body,
    color: Colors.textSecondary,
    lineHeight: 22,
    marginBottom: Spacing.md,
  },
  meta: {
    ...Typography.caption,
    marginBottom: Spacing.xl,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    flexWrap: 'wrap',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.full,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 6,
  },
  actionBtnDanger: {
    borderColor: Colors.danger,
  },
  actionBtnPressed: { opacity: 0.7 },
  actionIcon: { fontSize: 16 },
  actionLabel: { ...Typography.body, fontSize: 14 },
  actionLabelDanger: { color: Colors.danger },
});
