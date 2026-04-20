import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  Modal,
  Pressable,
  Image as RNImage,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import FolderSelector from "../components/FolderSelector";
import { getFolders } from "../db/folders";
import { Colors, Radius, Spacing, Typography } from "../theme";
import { Folder, ShareData } from "../types";
import { detectItemType, processAndSaveShare } from "../utils/shareHandler";

interface Props {
  shareData: ShareData;
  onSaved: () => void;
  onDismiss: () => void;
}

export default function ShareScreen({ shareData, onSaved, onDismiss }: Props) {
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(400)).current;

  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [loadingFolders, setLoadingFolders] = useState(true);

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      bounciness: 0,
      speed: 20,
    }).start();
  }, [slideAnim]);

  useEffect(() => {
    (async () => {
      const fs = await getFolders();
      setFolders(fs);
      if (fs.length > 0) setSelectedIds(new Set([fs[0].id]));
      setLoadingFolders(false);
    })();
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      handleDismiss();
      return true;
    });
    return () => sub.remove();
  }, []);

  const handleDismiss = useCallback(() => {
    Animated.timing(slideAnim, {
      toValue: 400,
      duration: 200,
      useNativeDriver: true,
    }).start(onDismiss);
  }, [slideAnim, onDismiss]);

  const toggleFolder = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const handleFolderCreated = useCallback((folder: Folder) => {
    setFolders((prev) => [folder, ...prev]);
    setSelectedIds((prev) => new Set([...prev, folder.id]));
  }, []);

  const handleSave = useCallback(async () => {
    if (selectedIds.size === 0) {
      Alert.alert("Select a folder", "Please select at least one folder.");
      return;
    }
    setSaving(true);
    try {
      await processAndSaveShare(shareData, [...selectedIds]);
      onSaved();
    } catch (e) {
      setSaving(false);
      Alert.alert("Error", `Failed to save item. ${e}`);
    }
  }, [shareData, selectedIds, onSaved]);

  const itemType = detectItemType(shareData.mimeType, shareData.data);
  const isImage = itemType === "image";
  const isLink = itemType === "url";
  const isText = itemType === "text";

  return (
    <Modal transparent animationType="none" onRequestClose={handleDismiss}>
      <Pressable style={styles.backdrop} onPress={handleDismiss} />

      <Animated.View
        style={[
          styles.sheet,
          { paddingBottom: insets.bottom + Spacing.lg },
          { transform: [{ translateY: slideAnim }] },
        ]}
      >
        <View style={styles.handle} />

        {/* Preview */}
        <View style={styles.previewSection}>
          {isImage ? (
            <RNImage source={{ uri: shareData.data }} style={styles.imagePreview} resizeMode="cover" />
          ) : isLink ? (
            <View style={styles.linkPreview}>
              <Text style={styles.linkEmoji}>🔗</Text>
              <Text style={styles.linkUrl} numberOfLines={2}>
                {shareData.data}
              </Text>
            </View>
          ) : isText ? (
            <View style={styles.textPreviewBox}>
              <Text style={styles.textPreviewContent} numberOfLines={4}>
                {shareData.data}
              </Text>
            </View>
          ) : (
            <View style={styles.linkPreview}>
              <Text style={styles.linkEmoji}>📎</Text>
              <Text style={styles.linkUrl} numberOfLines={1}>
                {shareData.data.split("/").pop() ?? "File"}
              </Text>
            </View>
          )}
        </View>

        {/* Folder picker */}
        {loadingFolders ? (
          <ActivityIndicator color={Colors.accent} style={{ marginVertical: Spacing.xl }} />
        ) : (
          <FolderSelector
            folders={folders}
            selectedIds={selectedIds}
            onToggle={toggleFolder}
            onFolderCreated={handleFolderCreated}
          />
        )}

        {/* Save button */}
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
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
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
