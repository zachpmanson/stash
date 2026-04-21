import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  Pressable,
  Image as RNImage,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useShareIntentContext } from "expo-share-intent";
import FolderSelector from "../components/FolderSelector";
import Debug from "../components/Debug";
import { getFolders } from "../db/folders";
import { Colors, Radius, Spacing, Typography } from "../theme";
import { Folder } from "../types";
import { processAndSaveShare } from "../utils/shareHandler";
import { useFolderStore } from "src/state/folderState";

export default function ShareScreen() {
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(400)).current;
  const router = useRouter();
  const { refresh, folders } = useFolderStore();
  const { shareIntent, resetShareIntent, hasShareIntent } = useShareIntentContext();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!hasShareIntent) {
      router.replace("/");
    }
  }, [hasShareIntent, router]);

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      bounciness: 0,
      speed: 20,
    }).start();
  }, [slideAnim]);

  const handleDismiss = useCallback(() => {
    Animated.timing(slideAnim, {
      toValue: 400,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      resetShareIntent();
      BackHandler.exitApp();
    });
  }, [slideAnim, resetShareIntent]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      handleDismiss();
      return true;
    });
    return () => sub.remove();
  }, [handleDismiss]);

  const toggleFolder = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const handleFolderCreated = useCallback((folder: Folder) => {
    refresh().then();
  }, []);

  const handleSave = useCallback(async () => {
    if (selectedIds.size === 0) {
      Alert.alert("Select a folder", "Please select at least one folder.");
      return;
    }
    setSaving(true);
    try {
      await processAndSaveShare(shareIntent, [...selectedIds]);
      refresh();
      resetShareIntent();
      BackHandler.exitApp();
    } catch (e) {
      setSaving(false);
      Alert.alert("Error", `Failed to save item. ${e}`);
    }
  }, [shareIntent, selectedIds, resetShareIntent]);

  const isImage = shareIntent.type === "media" && !!shareIntent.files?.[0]?.mimeType?.startsWith("image/");
  const isLink = shareIntent.type === "weburl";
  const isText = shareIntent.type === "text";
  const previewUri = isImage ? shareIntent.files![0].path : null;
  const displayText = isLink ? shareIntent.webUrl : shareIntent.text;
  const fileName = shareIntent.files?.[0]?.fileName;
  console.debug(selectedIds.entries());
  return (
    <View style={styles.container}>
      <Pressable style={styles.backdrop} onPress={handleDismiss} />

      <Animated.View
        style={[
          styles.sheet,
          { paddingBottom: insets.bottom + Spacing.lg },
          { transform: [{ translateY: slideAnim }] },
        ]}
      >
        <View style={styles.handle} />

        <View style={styles.previewSection}>
          {isImage && previewUri ? (
            <RNImage source={{ uri: previewUri }} style={styles.imagePreview} resizeMode="cover" />
          ) : isLink ? (
            <View style={styles.linkPreview}>
              <Text style={styles.linkEmoji}>🔗</Text>
              <Text style={styles.linkUrl} numberOfLines={2}>
                {shareIntent.webUrl}
              </Text>
            </View>
          ) : isText ? (
            <View style={styles.textPreviewBox}>
              <Text style={styles.textPreviewContent} numberOfLines={4}>
                {shareIntent.text}
              </Text>
            </View>
          ) : (
            <View style={styles.linkPreview}>
              <Text style={styles.linkEmoji}>📎</Text>
              <Text style={styles.linkUrl} numberOfLines={1}>
                {fileName ?? "File"}
              </Text>
            </View>
          )}
        </View>
        <Debug>{JSON.stringify(selectedIds.values(), null, 2)} </Debug>
        <Debug>{selectedIds.size} </Debug>

        <FolderSelector
          folders={folders}
          selectedIds={selectedIds}
          onToggle={toggleFolder}
          onFolderCreated={handleFolderCreated}
        />

        <Pressable
          style={({ pressed }) => [styles.saveBtn, saving && styles.saveBtnDisabled, pressed && styles.saveBtnPressed]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color={Colors.white} />
          ) : (
            <Text style={styles.saveBtnText}>Save{selectedIds.size > 1 ? ` to ${selectedIds.size} folders` : ""}</Text>
          )}
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.overlay,
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    maxHeight: "85%",
    minHeight: 500,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.textMuted,
    alignSelf: "center",
    marginBottom: Spacing.md,
  },
  previewSection: {
    marginBottom: Spacing.md,
  },
  imagePreview: {
    width: "100%",
    height: 140,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface2,
  },
  linkPreview: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface2,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  linkEmoji: { fontSize: 24 },
  linkUrl: { ...Typography.caption, color: Colors.text, flex: 1, lineHeight: 18 },
  textPreviewBox: {
    backgroundColor: Colors.surface2,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  textPreviewContent: { ...Typography.body, lineHeight: 22, color: Colors.text },
  saveBtn: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.full,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    marginTop: Spacing.md,
    marginHorizontal: Spacing.sm,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnPressed: { opacity: 0.85 },
  saveBtnText: { ...Typography.body, fontWeight: "700", color: Colors.white, fontSize: 16 },
});
