import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Linking,
  Share,
  Image,
  ActivityIndicator,
  Switch,
  Modal,
  RefreshControl,
} from "react-native";
import { shareAsync, isAvailableAsync } from "expo-sharing";
import { useArticle } from "../hooks/useArticle";
import { showModal } from "src/state/modalState";
import { showSnackbar } from "src/state/snackbarState";
import * as Clipboard from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Colors, Spacing, Typography, Radius } from "../theme";
import { StashItem } from "../types";
import { getItemById, archiveItem } from "../db/items";
import Screen from "../components/Screen";
import TopbarButton from "src/components/TopbarButton";
import { MaterialIcons } from "@expo/vector-icons";
import { arrIf } from "src/utils/array";

export default function ItemDetailScreen() {
  const { id: itemId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [item, setItem] = useState<StashItem | null>(null);
  const [splitBySentence, setSplitBySentence] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { state: articleState, sentences, refresh: refreshArticle, refreshing } = useArticle(
    item?.type === "url" ? item.uri : undefined,
    item?.id,
    item?.article_text,
  );

  useEffect(() => {
    getItemById(itemId).then(setItem);
  }, [itemId]);

  const handleOpen = useCallback(() => {
    if (!item) return;
    if (item.type === "url") {
      Linking.openURL(item.uri).catch(() => showModal({ title: "Cannot open URL", message: item.uri }));
    }
  }, [item]);

  const handleCopy = useCallback(async () => {
    if (!item) return;
    await Clipboard.setStringAsync(item.uri);
    showSnackbar("Link copied to clipboard", "success");
  }, [item]);

  const handleShare = useCallback(async () => {
    if (!item) return;
    if (item.type === "image" || item.type === "file") {
      if (await isAvailableAsync()) {
        await shareAsync(item.uri, item.mime_type ? { mimeType: item.mime_type } : undefined);
        return;
      }
    }
    await Share.share({ message: item.uri });
  }, [item]);

  const handleArchive = useCallback(() => {
    if (!item) return;
    showModal({
      title: "Archive item?",
      message: "You can unarchive it later.",
      buttons: [
        { text: "Cancel", style: "cancel" },
        {
          text: "Archive",
          style: "destructive",
          onPress: async () => {
            await archiveItem(item.id);
            router.back();
          },
        },
      ],
    });
  }, [item, router]);

  if (!item) return null;

  return (
    <Screen
      title="Stashed Item"
      buttons={[
        <TopbarButton onPress={handleArchive}>
          <MaterialIcons name="archive" size={20} color={Colors.text} />
        </TopbarButton>,
        <TopbarButton onPress={handleShare}>
          <MaterialIcons name="share" size={20} color={Colors.text} />
        </TopbarButton>,
        ...arrIf(
          item.type === "url",
          <TopbarButton onPress={() => setMenuOpen(true)}>
            <MaterialIcons name="more-vert" size={20} color={Colors.text} />
          </TopbarButton>,
        ),
      ]}
    >
      <ScrollView
        contentContainerStyle={{ paddingBottom: Spacing.xl }}
        refreshControl={
          item.type === "url" ? (
            <RefreshControl refreshing={refreshing} onRefresh={refreshArticle} tintColor={Colors.accent} />
          ) : undefined
        }
      >
        {item.type === "image" && <Image source={{ uri: item.uri }} style={styles.fullImage} resizeMode="contain" />}

        {item.type === "url" && item.thumbnail_path && (
          <Image source={{ uri: item.thumbnail_path }} style={styles.ogImage} resizeMode="cover" />
        )}

        <View style={styles.body}>
          {item.title ? <Text style={styles.title}>{item.title}</Text> : null}

          {item.type === "url" && (
            <Pressable onPress={handleOpen}>
              <Text style={styles.url} numberOfLines={3}>
                {item.uri}
              </Text>
            </Pressable>
          )}

          {item.type === "text" && (
            <Text style={styles.textContent} selectable>
              {item.uri}
            </Text>
          )}


          {item.description ? <Text style={styles.description}>{item.description}</Text> : null}

          <Text style={styles.meta}>Saved {new Date(item.created_at).toLocaleString()}</Text>

          <View style={styles.actions}>
            {item.type === "url" && (
              <>
                <ActionButton label="Listen" icon="🎧" onPress={() => router.push(`/listen/${item.id}`)} />
                <ActionButton label="Open" icon="🌐" onPress={handleOpen} />
                <ActionButton label="Copy" icon="📋" onPress={handleCopy} />
              </>
            )}
            {item.type === "text" && (
              <ActionButton label="Listen" icon="🎧" onPress={() => router.push(`/listen/${item.id}`)} />
            )}
            <ActionButton label="Share" icon="↗️" onPress={handleShare} />
            <ActionButton label="Archive" icon="🗃️" onPress={handleArchive} danger />
          </View>

          {item.type === "url" && (
            <View style={styles.article}>
              {articleState.kind === "loading" && (
                <View style={styles.articleStatus}>
                  <ActivityIndicator color={Colors.accent} />
                  <Text style={styles.articleStatusText}>Loading article…</Text>
                </View>
              )}
              {articleState.kind === "error" && <Text style={styles.articleError}>{articleState.message}</Text>}
              {articleState.kind === "ready" &&
                (splitBySentence && sentences
                  ? sentences.map((s, i) => (
                      <Text style={styles.articleText} key={i} selectable>
                        {s}
                      </Text>
                    ))
                  : articleState.text.split("\n").map((s, i) => (
                      <Text style={styles.articleText} key={i} selectable>
                        {s}
                      </Text>
                    )))}
            </View>
          )}
        </View>
      </ScrollView>
      <Modal transparent visible={menuOpen} animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)}>
          <View style={styles.menu}>
            <Pressable style={styles.menuItem} onPress={() => setSplitBySentence((v) => !v)}>
              <Text style={styles.menuItemLabel}>Split by sentence</Text>
              <Switch value={splitBySentence} onValueChange={setSplitBySentence} />
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </Screen>
  );
}

function ActionButton({
  label,
  icon,
  onPress,
  danger,
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
    width: "100%",
    height: 320,
    backgroundColor: Colors.surface2,
  },
  ogImage: {
    width: "100%",
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
    flexDirection: "row",
    gap: Spacing.sm,
    flexWrap: "wrap",
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
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
  article: {
    marginTop: Spacing.xl,
    paddingTop: Spacing.lg,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: 12,
  },
  articleStatus: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
  },
  articleStatusText: { ...Typography.caption },
  articleError: { ...Typography.body, color: Colors.danger },
  articleText: {
    ...Typography.body,
    fontFamily: "serif",
    fontSize: 14,
    lineHeight: 26,
  },
  splitToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  splitToggleLabel: { ...Typography.caption },
  menuBackdrop: {
    flex: 1,
    alignItems: "flex-end",
    paddingTop: 56,
    paddingHorizontal: Spacing.sm,
    backgroundColor: "transparent",
  },
  menu: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    minWidth: 220,
    paddingVertical: Spacing.xs,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    gap: Spacing.md,
  },
  menuItemLabel: { ...Typography.body, fontSize: 14 },
});
