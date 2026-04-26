import React from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Colors, Radius, Spacing, Typography } from "../theme";
import { StashItem } from "../types";

interface Props {
  item: StashItem;
  onPress: () => void;
  onLongPress?: () => void;
}

export default function ItemCard({ item, onPress, onLongPress }: Props) {
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      onPress={onPress}
      onLongPress={onLongPress}
    >
      {item.type === "image" && item.thumbnail_path ? (
        <Image source={{ uri: item.thumbnail_path }} style={styles.image} resizeMode="cover" />
      ) : item.type === "url" ? (
        <UrlPreview item={item} />
      ) : item.type === "text" ? (
        <TextPreview item={item} />
      ) : (
        <FilePreview item={item} />
      )}

      <View style={styles.meta}>
        {item.title ? (
          <Text style={styles.title} numberOfLines={2}>
            {item.title}
          </Text>
        ) : null}
        <Text style={styles.date}>{formatDate(item.created_at)}</Text>
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

function TextPreview({ item }: { item: StashItem }) {
  return (
    <View style={styles.textPreview}>
      <Text style={styles.textSnippet} numberOfLines={6}>
        {item.uri}
      </Text>
    </View>
  );
}

function FilePreview({ item }: { item: StashItem }) {
  const ext = item.mime_type?.split("/")[1]?.toUpperCase() ?? "FILE";
  return (
    <View style={styles.filePreview}>
      <Text style={styles.fileIcon}>📎</Text>
      <Text style={styles.fileExt}>{ext}</Text>
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
  textPreview: {
    width: "100%",
    aspectRatio: 1 / 0.605,
    backgroundColor: Colors.surface2,
    padding: Spacing.sm,
    justifyContent: "flex-start",
  },
  textSnippet: {
    ...Typography.caption,
    lineHeight: 18,
  },
  filePreview: {
    width: "100%",
    aspectRatio: 1 / 0.605,
    backgroundColor: Colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  fileIcon: { fontSize: 32, marginBottom: 4 },
  fileExt: { ...Typography.label, color: Colors.textSecondary },
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
