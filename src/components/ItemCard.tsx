import React, { useMemo } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Colors, Radius, Spacing, Typography } from "../theme";
import { StashItem } from "../types";
import { estimateReadLabel } from "../utils/speech";

interface Props {
  item: StashItem;
  onPress: () => void;
  onLongPress?: () => void;
}

export default function ItemCard({ item, onPress, onLongPress }: Props) {
  const readEstimate = useMemo(() => {
    if (item.type === "text") return estimateReadLabel(item.uri);
    if (item.type === "url") return estimateReadLabel(item.article_text);
    return null;
  }, [item.type, item.uri, item.article_text]);

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      onPress={onPress}
      onLongPress={onLongPress}
    >
      {item.type === "image" && item.thumbnail_path ? (
        <Image source={{ uri: item.thumbnail_path }} style={styles.image} resizeMode="cover" />
      ) : item.type === "url" && item.thumbnail_path ? (
        <UrlPreview item={item} />
      ) : null}

      {(item.listened_percent ?? 0) > 0 && (item.listened_percent ?? 0) < 100 && (
        <View style={styles.listenProgressBar}>
          <View style={[styles.listenProgressFill, { width: `${item.listened_percent ?? 0}%` }]} />
        </View>
      )}

      <View style={styles.meta}>
        {item.type === "url" && !item.thumbnail_path ? (
          <View style={styles.compactRow}>
            {item.favicon_url ? <Image source={{ uri: item.favicon_url }} style={styles.favicon} /> : null}
            <Text style={styles.compactLabel} numberOfLines={1}>
              {safeHostname(item.uri)}
            </Text>
          </View>
        ) : item.type === "file" ? (
          <View style={styles.compactRow}>
            <Text style={styles.compactIcon}>📎</Text>
            <Text style={styles.compactLabel} numberOfLines={1}>
              {item.mime_type?.split("/")[1]?.toUpperCase() ?? "FILE"}
            </Text>
          </View>
        ) : null}
        {item.title ? (
          <Text style={styles.title} numberOfLines={2}>
            {item.title}
          </Text>
        ) : item.type === "text" ? (
          <Text style={styles.title} numberOfLines={2}>
            {item.uri}
          </Text>
        ) : null}
        <Text style={styles.date}>
          {formatDate(item.created_at)}
          {readEstimate ? ` · ${readEstimate}` : ""}
        </Text>
      </View>
    </Pressable>
  );
}

function UrlPreview({ item }: { item: StashItem }) {
  return (
    <View style={styles.urlPreview}>
      {item.thumbnail_path ? (
        <Image source={{ uri: item.thumbnail_path }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : null}
      <View style={styles.urlOverlay}>
        {item.favicon_url ? <Image source={{ uri: item.favicon_url }} style={styles.favicon} /> : null}
        <View style={styles.urlDomain}>
          <Text style={styles.domainText} numberOfLines={1}>
            {safeHostname(item.uri)}
          </Text>
        </View>
      </View>
    </View>
  );
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return url;
  }
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - ts;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pressed: { opacity: 0.8 },
  image: {
    width: "100%",
    aspectRatio: 1 / 0.715,
    backgroundColor: Colors.surface2,
  },
  urlPreview: {
    width: "100%",
    aspectRatio: 1 / 0.605,
    backgroundColor: Colors.surface2,
    overflow: "hidden",
  },
  urlOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
    padding: Spacing.sm,
    justifyContent: "flex-end",
    flexDirection: "row",
    alignItems: "flex-end",
  },
  favicon: {
    width: 16,
    height: 16,
    borderRadius: 3,
    marginRight: 4,
  },
  urlDomain: {},
  domainText: {
    ...Typography.caption,
    color: Colors.white,
    fontSize: 11,
  },
  compactRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  compactIcon: { fontSize: 14, marginRight: 4 },
  compactLabel: {
    ...Typography.caption,
    color: Colors.textSecondary,
    fontSize: 11,
  },
  listenProgressBar: {
    height: 3,
    backgroundColor: Colors.surface2,
  },
  listenProgressFill: {
    height: "100%",
    backgroundColor: Colors.accent,
  },
  meta: {
    padding: Spacing.sm,
  },
  title: {
    ...Typography.caption,
    color: Colors.text,
    fontWeight: "500",
    marginBottom: 2,
    lineHeight: 17,
  },
  date: {
    ...Typography.caption,
    fontSize: 11,
  },
});
