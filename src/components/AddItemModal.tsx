import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import FolderSelector from "src/components/FolderSelector";
import { useFolderStore } from "src/state/folderState";
import { showModal } from "src/state/modalState";
import { Colors, Radius, Spacing, Typography } from "src/theme";
import { Folder } from "src/types";
import { isUrl } from "src/utils/fileUtils";
import { saveManualItem } from "src/utils/shareHandler";

type ItemMode = "url" | "text" | "image";

type Props = {
  visible: boolean;
  mode: ItemMode | null;
  onClose: () => void;
  initialFolderId?: string;
  onSaved?: () => void;
};

export default function AddItemModal({ visible, mode, onClose, initialFolderId, onSaved }: Props) {
  const insets = useSafeAreaInsets();
  const { folders, refresh } = useFolderStore();

  const [urlText, setUrlText] = useState("");
  const [textBody, setTextBody] = useState("");
  const [imageAsset, setImageAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const reset = useCallback(() => {
    setUrlText("");
    setTextBody("");
    setImageAsset(null);
    setSelectedIds(initialFolderId ? new Set([initialFolderId]) : new Set());
    setSaving(false);
  }, [initialFolderId]);

  useEffect(() => {
    if (visible) {
      setSelectedIds(initialFolderId ? new Set([initialFolderId]) : new Set());
    } else {
      reset();
    }
  }, [visible, initialFolderId, reset]);

  const titleByMode: Record<ItemMode, string> = {
    url: "New Link",
    text: "New Text",
    image: "New Image",
  };

  const toggleFolder = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const handleFolderCreated = useCallback(
    (folder: Folder) => {
      refresh().then(() => toggleFolder(folder.id));
    },
    [refresh, toggleFolder],
  );

  const pickImage = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      showModal({ title: "Permission needed", message: "Allow photo access to attach an image." });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
      allowsMultipleSelection: false,
    });
    if (!result.canceled && result.assets[0]) {
      setImageAsset(result.assets[0]);
    }
  }, []);

  const inputValid = useMemo(() => {
    if (mode === "url") return isUrl(urlText);
    if (mode === "text") return textBody.trim().length > 0;
    if (mode === "image") return imageAsset !== null;
    return false;
  }, [mode, urlText, textBody, imageAsset]);

  const canSave = inputValid && selectedIds.size > 0 && !saving;

  const handleSave = useCallback(async () => {
    if (!canSave || !mode) return;
    setSaving(true);
    try {
      const folderIds = [...selectedIds];
      if (mode === "url") {
        await saveManualItem({ type: "url", value: urlText.trim() }, folderIds);
      } else if (mode === "text") {
        await saveManualItem({ type: "text", value: textBody }, folderIds);
      } else if (mode === "image" && imageAsset) {
        await saveManualItem(
          {
            type: "image",
            localUri: imageAsset.uri,
            mimeType: imageAsset.mimeType ?? "image/jpeg",
          },
          folderIds,
        );
      }
      await refresh();
      onSaved?.();
      onClose();
    } catch (e) {
      setSaving(false);
      showModal({ title: "Error", message: `Failed to save item. ${e}` });
    }
  }, [canSave, mode, urlText, textBody, imageAsset, selectedIds, refresh, onSaved, onClose]);

  const renderCompose = () => {
    if (mode === "url") {
      return (
        <View>
          <Text style={styles.label}>URL</Text>
          <TextInput
            style={styles.input}
            value={urlText}
            onChangeText={setUrlText}
            placeholder="https://example.com"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            autoFocus
            selectionColor={Colors.accent}
          />
          {urlText.length > 0 && !isUrl(urlText) && <Text style={styles.errorText}>Enter a valid http(s) URL</Text>}
        </View>
      );
    }
    if (mode === "text") {
      return (
        <View>
          <Text style={styles.label}>Text</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={textBody}
            onChangeText={setTextBody}
            placeholder="Type or paste text..."
            placeholderTextColor={Colors.textMuted}
            multiline
            autoFocus
            selectionColor={Colors.accent}
          />
        </View>
      );
    }
    if (mode === "image") {
      return (
        <View>
          <Text style={styles.label}>Image</Text>
          {imageAsset ? (
            <Pressable onPress={pickImage} style={styles.imagePreviewWrap}>
              <Image source={{ uri: imageAsset.uri }} style={styles.imagePreview} contentFit="cover" />
              <Text style={styles.imageHint}>Tap to change</Text>
            </Pressable>
          ) : (
            <Pressable onPress={pickImage} style={({ pressed }) => [styles.pickBtn, pressed && styles.pressed]}>
              <Text style={styles.pickBtnText}>Choose from gallery</Text>
            </Pressable>
          )}
        </View>
      );
    }
    return null;
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <View
            style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg, paddingTop: insets.top + Spacing.md }]}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.header}>
              <View style={{ width: 60 }} />
              <Text style={styles.title}>{mode ? titleByMode[mode] : "Add Item"}</Text>
              <Pressable onPress={onClose} hitSlop={8}>
                <Text style={styles.headerBtn}>Close</Text>
              </Pressable>
            </View>

            {mode && (
              <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
                {renderCompose()}
                <View style={styles.folderSection}>
                  <FolderSelector
                    folders={folders}
                    selectedIds={selectedIds}
                    onToggle={toggleFolder}
                    onFolderCreated={handleFolderCreated}
                  />
                </View>
              </ScrollView>
            )}

            {mode && (
              <Pressable
                style={({ pressed }) => [
                  styles.saveBtn,
                  !canSave && styles.saveBtnDisabled,
                  pressed && canSave && styles.pressed,
                ]}
                onPress={handleSave}
                disabled={!canSave}
              >
                {saving ? (
                  <ActivityIndicator color={Colors.white} />
                ) : (
                  <Text style={styles.saveBtnText}>
                    Save{selectedIds.size > 1 ? ` to ${selectedIds.size} folders` : ""}
                  </Text>
                )}
              </Pressable>
            )}
          </View>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: "flex-end",
  },
  sheet: {
    flex: 1,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.sm,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.md,
  },
  title: {
    ...Typography.subheading,
  },
  headerBtn: {
    ...Typography.body,
    color: Colors.accent,
    fontWeight: "600",
    minWidth: 60,
  },
  scrollContent: {
    paddingBottom: Spacing.md,
  },
  label: {
    ...Typography.label,
    marginBottom: Spacing.sm,
  },
  input: {
    backgroundColor: Colors.surface2,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    color: Colors.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  textArea: {
    minHeight: 120,
    textAlignVertical: "top",
    paddingTop: Spacing.sm,
  },
  errorText: {
    ...Typography.caption,
    color: Colors.danger,
    marginTop: Spacing.xs,
  },
  pickBtn: {
    backgroundColor: Colors.surface2,
    borderRadius: Radius.md,
    paddingVertical: Spacing.lg,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: "dashed",
  },
  pickBtnText: {
    ...Typography.body,
    color: Colors.accent,
    fontWeight: "600",
  },
  imagePreviewWrap: {
    alignItems: "center",
    gap: Spacing.sm,
  },
  imagePreview: {
    width: "100%",
    height: 200,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface2,
  },
  imageHint: {
    ...Typography.caption,
    color: Colors.accent,
  },
  folderSection: {
    marginTop: Spacing.lg,
    minHeight: 280,
  },
  saveBtn: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.full,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    marginTop: Spacing.md,
    marginHorizontal: Spacing.sm,
  },
  saveBtnDisabled: {
    opacity: 0.5,
  },
  saveBtnText: {
    ...Typography.body,
    fontWeight: "700",
    color: Colors.white,
    fontSize: 16,
  },
  pressed: {
    opacity: 0.85,
  },
});
