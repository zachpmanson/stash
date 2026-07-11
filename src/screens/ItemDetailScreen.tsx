import { MaterialIcons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { useLocalSearchParams, useRouter } from "expo-router";
import { isAvailableAsync, shareAsync } from "expo-sharing";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import RenderHtml from "react-native-render-html";
import OverflowMenu from "src/components/OverflowMenu";
import TopbarButton from "src/components/TopbarButton";
import { showModal } from "src/state/modalState";
import { showSnackbar } from "src/state/snackbarState";
import Screen from "../components/Screen";
import { archiveItem, getItemById } from "../db/items";
import { useArticle } from "../hooks/useArticle";
import { Colors, Radius, Spacing, Typography } from "../theme";
import { StashItem } from "../types";
import { archiveIsUrl, archiveOrgUrl } from "../utils/readability";
import { estimateReadLabel } from "../utils/speech";

export default function ItemDetailScreen() {
  const { id: itemId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [item, setItem] = useState<StashItem | null>(null);
  const [splitBySentence, setSplitBySentence] = useState(false);
  const [showFormatted, setShowFormatted] = useState(true);
  const [showRawHtml, setShowRawHtml] = useState(false);
  const { width: windowWidth } = useWindowDimensions();
  const {
    state: articleState,
    sentences,
    refresh: refreshArticle,
    loadFrom: loadArticleFrom,
    refreshing,
  } = useArticle(item?.type === "url" ? item.uri : undefined, item?.id, item?.article_text, item?.article_html);

  const readEstimate = useMemo(() => {
    if (item?.type === "text") return estimateReadLabel(item.uri);
    if (item?.type === "url" && articleState.kind === "ready") return estimateReadLabel(articleState.text);
    return null;
  }, [item, articleState]);

  const handleLoadFromArchive = useCallback(
    (source: "is" | "org") => {
      if (!item || item.type !== "url") return;
      const archiveUrl = source === "is" ? archiveIsUrl(item.uri) : archiveOrgUrl(item.uri);
      loadArticleFrom(archiveUrl).catch(() => {});
    },
    [item, loadArticleFrom],
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

  const handleOpenImage = useCallback(async () => {
    if (!item || item.type !== "image") return;
    try {
      const contentUri = await FileSystem.getContentUriAsync(item.uri);
      await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
        data: contentUri,
        flags: 1,
        type: item.mime_type ?? "image/*",
      });
    } catch {
      showModal({ title: "Cannot open image", message: "No gallery app available." });
    }
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
      buttons={
        <>
          <TopbarButton onPress={handleArchive}>
            <MaterialIcons name="archive" size={20} color={Colors.text} />
          </TopbarButton>
          <TopbarButton onPress={handleShare}>
            <MaterialIcons name="share" size={20} color={Colors.text} />
          </TopbarButton>
          {item.type === "url" && (
            <OverflowMenu
              items={[
                ...(articleState.kind === "ready" && articleState.html
                  ? [
                      {
                        title: showFormatted ? "Show plain text" : "Show formatted",
                        onPress: () => setShowFormatted((v) => !v),
                      },
                      {
                        title: showRawHtml ? "Hide raw HTML" : "Show raw HTML",
                        onPress: () => setShowRawHtml((v) => !v),
                      },
                    ]
                  : []),
                {
                  title: splitBySentence ? "Unsplit sentences" : "Split by sentence",
                  onPress: () => setSplitBySentence((v) => !v),
                },
                { title: "Load from archive.is", onPress: () => handleLoadFromArchive("is") },
                { title: "Load from archive.org", onPress: () => handleLoadFromArchive("org") },
              ]}
            />
          )}
        </>
      }
    >
      <ScrollView
        contentContainerStyle={{ paddingBottom: Spacing.xl }}
        refreshControl={
          item.type === "url" ? (
            <RefreshControl refreshing={refreshing} onRefresh={refreshArticle} tintColor={Colors.accent} />
          ) : undefined
        }
      >
        {item.type === "image" && (
          <Pressable onPress={handleOpenImage}>
            <Image source={{ uri: item.uri }} style={styles.fullImage} resizeMode="contain" />
          </Pressable>
        )}

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

          <Text style={styles.meta}>
            Saved {new Date(item.created_at).toLocaleString()}
            {readEstimate ? ` · ${readEstimate}` : ""}
            {(item.listened_percent ?? 0) > 0 ? ` · ${item.listened_percent}% listened` : ""}
          </Text>

          {(item.listened_percent ?? 0) > 0 && (item.listened_percent ?? 0) < 100 && (item.type === "url" || item.type === "text") && (
            <View style={styles.listenProgressBar}>
              <View style={[styles.listenProgressFill, { width: `${item.listened_percent ?? 0}%` }]} />
            </View>
          )}

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
                (showRawHtml && articleState.html ? (
                  <Text style={styles.rawHtml} selectable>
                    {articleState.html}
                  </Text>
                ) : showFormatted && articleState.html && !splitBySentence ? (
                  <RenderHtml
                    contentWidth={windowWidth - Spacing.md * 2}
                    source={{ html: articleState.html }}
                    baseStyle={styles.articleText}
                    tagsStyles={htmlTagStyles}
                    systemFonts={["serif", "mono"]}
                    defaultTextProps={{ selectable: true }}
                  />
                ) : splitBySentence && sentences ? (
                  sentences.map((s, i) => (
                    <Text
                      style={[styles.articleText, s.mode === "quote" && { fontStyle: "italic" }]}
                      key={i}
                      selectable
                    >
                      {s.text}
                    </Text>
                  ))
                ) : (
                  articleState.text.split("\n").map((s, i) => (
                    <Text style={styles.articleText} key={i} selectable>
                      {s}
                    </Text>
                  ))
                ))}
            </View>
          )}
        </View>
      </ScrollView>
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

const htmlTagStyles = StyleSheet.create({
  a: { color: Colors.textSecondary, textDecorationLine: "underline" as const },
  h1: { ...Typography.subheading, marginTop: Spacing.md, marginBottom: Spacing.sm },
  h2: { ...Typography.subheading, marginTop: Spacing.md, marginBottom: Spacing.sm },
  h3: { ...Typography.subheading, marginTop: Spacing.md, marginBottom: Spacing.sm },
  blockquote: {
    borderLeftWidth: 3,
    borderLeftColor: Colors.border,
    paddingLeft: Spacing.md,
    marginVertical: Spacing.sm,
    color: Colors.textSecondary,
  },
  pre: {
    backgroundColor: Colors.surface2,
    padding: Spacing.sm,
    borderRadius: Radius.sm,
  },
  code: {
    backgroundColor: Colors.surface2,
    paddingHorizontal: 4,
    borderRadius: Radius.sm,
    fontFamily: "monospace",
  },
  img: { marginVertical: Spacing.sm },
  figure: { marginVertical: Spacing.sm },
  p: {
    marginVertical: Spacing.sm,
  },
});

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
    marginBottom: Spacing.sm,
  },
  listenProgressBar: {
    height: 3,
    backgroundColor: Colors.surface2,
    borderRadius: Radius.full,
    overflow: "hidden",
    marginBottom: Spacing.lg,
  },
  listenProgressFill: {
    height: "100%",
    backgroundColor: Colors.accent,
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
    gap: 6,
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
  rawHtml: {
    ...Typography.body,
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 18,
  },
  splitToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  splitToggleLabel: { ...Typography.caption },
});
