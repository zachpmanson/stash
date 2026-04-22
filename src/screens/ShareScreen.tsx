import { Image } from "expo-image";
import { ResolvedSharePayload, useIncomingShare } from "expo-sharing";
import {
  Alert,
  AppState,
  BackHandler,
  Pressable,
  ScrollView,
  View,
  StyleSheet,
  ActivityIndicator,
  Text,
} from "react-native";
import { processAndSaveShare } from "src/utils/shareHandler";
import { Colors, Radius, Spacing, Typography } from "src/theme";
import Debug from "src/components/Debug";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import FolderSelector from "src/components/FolderSelector";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFolderStore } from "src/state/folderState";
import { Folder } from "src/types";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { setExcludeFromRecents } from "src/utils/nativeShareIntent";
function fiveSecondsAgo() {
  return Date.now() - 5000;
}
export default function ShareReceived() {
  const router = useRouter();
  const { t } = useLocalSearchParams<{ t: string }>();

  const { resolvedSharedPayloads, isResolving, clearSharedPayloads, refreshSharePayloads } = useIncomingShare();

  const insets = useSafeAreaInsets();
  const { refresh, folders } = useFolderStore();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const handleDismiss = useCallback(() => {
    console.debug("dismiss run, clearing payload");
    clearSharedPayloads();
    refreshSharePayloads();
    BackHandler.exitApp();
  }, [clearSharedPayloads, refreshSharePayloads]);

  const toggleFolder = useCallback((id: string) => {
    console.debug(`Debugging ${id}`);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const handleFolderCreated = useCallback((folder: Folder) => {
    refresh().then(() => {
      toggleFolder(folder.id);
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (selectedIds.size === 0) {
      Alert.alert("Select a folder", "Please select at least one folder.");
      return;
    }
    if (resolvedSharedPayloads.length === 0) return;
    setSaving(true);
    try {
      for (const payload of resolvedSharedPayloads) {
        await processAndSaveShare(payload, [...selectedIds]);
      }
      refresh();
      clearSharedPayloads();
      router.replace("/");
      BackHandler.exitApp();
    } catch (e) {
      setSaving(false);
      Alert.alert("Error", `Failed to save item. ${e}`);
    }
  }, [selectedIds, resolvedSharedPayloads, clearSharedPayloads, refresh]);

  if (isResolving) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Pressable
        style={styles.backdrop}
        onPress={() => {
          handleDismiss();
        }}
      />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
        {resolvedSharedPayloads.length > 1 ? (
          <ScrollView horizontal style={styles.previewSection} contentContainerStyle={styles.previewContent}>
            {resolvedSharedPayloads.map((payload, index) => (
              <Fragment key={index}>
                {payload.shareType === "image" ? (
                  <Image
                    source={{ uri: payload.contentUri ?? undefined }}
                    style={[styles.imagePreview, styles.smallImage]}
                  />
                ) : payload.shareType === "text" ? (
                  <Text>{payload.value}</Text>
                ) : null}
              </Fragment>
            ))}
          </ScrollView>
        ) : (
          <View style={styles.previewSection}>
            {resolvedSharedPayloads.map((payload, index) => (
              <Fragment key={index}>
                {payload.shareType === "image" ? (
                  <Image source={{ uri: payload.contentUri ?? undefined }} style={[styles.imagePreview]} />
                ) : payload.shareType === "text" ? (
                  <Text>{payload.value}</Text>
                ) : null}
              </Fragment>
            ))}
          </View>
        )}

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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // container: {
  //   flex: 1,
  //   alignItems: "center",
  //   justifyContent: "center",
  //   backgroundColor: "white",
  // },
  image: {
    width: 300,
    height: 300,
    marginBottom: 20,
    borderRadius: 10,
  },

  container: {
    ...StyleSheet.absoluteFill,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
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
  previewContent: {
    gap: Spacing.sm,
  },
  imagePreview: {
    width: "100%",
    height: 140,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface2,
    objectFit: "fill",
  },
  smallImage: {
    width: 140,
    height: 140,
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
