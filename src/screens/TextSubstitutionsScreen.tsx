import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import Modal from "../components/Modal";
import Screen from "../components/Screen";
import TopbarButton from "../components/TopbarButton";
import { showModal } from "../state/modalState";
import { Colors, Radius, Spacing, Typography } from "../theme";
import { TextSubstitution } from "../types";
import { createTextSubstitution, deleteTextSubstitution, getTextSubstitutions } from "../db/textSubstitutions";

export default function TextSubstitutionsScreen() {
  const [subs, setSubs] = useState<TextSubstitution[]>([]);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    setSubs(await getTextSubstitutions());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleRowPress = useCallback(
    (sub: TextSubstitution) => {
      showModal({
        title: `${sub.find} → ${sub.replace}`,
        buttons: [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              await deleteTextSubstitution(sub.id);
              load();
            },
          },
        ],
      });
    },
    [load],
  );

  const isEmpty = subs.length === 0;

  return (
    <Screen
      options={{ title: "Text Substitutions" }}
      buttons={[
        <TopbarButton key="add" onPress={() => setAddOpen(true)}>
          <MaterialIcons name="add" size={22} color={Colors.text} />
        </TopbarButton>,
      ]}
    >
      <AddSubstitutionModal
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={async () => {
          setAddOpen(false);
          await load();
        }}
      />
      {isEmpty ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🗣️</Text>
          <Text style={styles.emptyTitle}>No substitutions yet</Text>
          <Text style={styles.emptyBody}>
            Add a find/replace pair to nudge the TTS voice toward better pronunciation. For example, replace "GIF" with
            "jif".
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {subs.map((sub) => (
            <Pressable
              key={sub.id}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => handleRowPress(sub)}
              onLongPress={() => handleRowPress(sub)}
            >
              <View style={styles.rowText}>
                <Text style={styles.rowFind} numberOfLines={1}>
                  {sub.find}
                </Text>
                <Text style={styles.rowArrow}>→</Text>
                <Text style={styles.rowReplace} numberOfLines={1}>
                  {sub.replace}
                </Text>
              </View>
              {sub.case_sensitive === 1 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>Aa</Text>
                </View>
              )}
            </Pressable>
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}

function AddSubstitutionModal({
  visible,
  onClose,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) {
      setFind("");
      setReplace("");
      setCaseSensitive(false);
      setSaving(false);
    }
  }, [visible]);

  const canSave = find.trim().length > 0 && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await createTextSubstitution(find.trim(), replace, caseSensitive);
      onSaved();
    } catch (e) {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} onClose={onClose}>
      <Text style={styles.dialogTitle}>Add substitution</Text>

      <Text style={styles.fieldLabel}>Find</Text>
      <TextInput
        style={styles.input}
        value={find}
        onChangeText={setFind}
        placeholder="e.g. GIF"
        placeholderTextColor={Colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.fieldLabel}>Replace with</Text>
      <TextInput
        style={styles.input}
        value={replace}
        onChangeText={setReplace}
        placeholder="e.g. jif"
        placeholderTextColor={Colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <View style={styles.switchRow}>
        <Text style={styles.fieldLabel}>Case sensitive</Text>
        <Switch
          value={caseSensitive}
          onValueChange={setCaseSensitive}
          trackColor={{ true: Colors.accent, false: Colors.surface2 }}
        />
      </View>

      <View style={styles.dialogButtons}>
        <Pressable style={styles.dialogBtn} onPress={onClose}>
          <Text style={styles.dialogBtnText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={[styles.dialogBtn, styles.dialogBtnPrimary, !canSave && styles.dialogBtnDisabled]}
          onPress={save}
          disabled={!canSave}
        >
          <Text style={[styles.dialogBtnText, styles.dialogBtnPrimaryText]}>Save</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  list: {
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  rowPressed: { opacity: 0.7 },
  rowText: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  rowFind: { ...Typography.body, fontWeight: "600", flexShrink: 1 },
  rowArrow: { ...Typography.body, color: Colors.textMuted },
  rowReplace: { ...Typography.body, flexShrink: 1 },
  badge: {
    backgroundColor: Colors.surface2,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
  },
  badgeText: { ...Typography.caption, fontSize: 11 },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
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

  dialogTitle: { ...Typography.subheading, marginBottom: Spacing.sm },
  fieldLabel: { ...Typography.caption, color: Colors.textMuted },
  input: {
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    ...Typography.body,
    color: Colors.text,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: Spacing.sm,
  },
  dialogButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  dialogBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.sm,
  },
  dialogBtnPrimary: { backgroundColor: Colors.accent },
  dialogBtnDisabled: { opacity: 0.4 },
  dialogBtnText: { ...Typography.body },
  dialogBtnPrimaryText: { color: Colors.white, fontWeight: "600" },
});
