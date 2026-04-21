import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Colors, Spacing, Typography, Radius } from '../theme';
import { updateFolderName } from '../db/folders';

export default function EditFolderScreen() {
  const { id: folderId, folderName } = useLocalSearchParams<{ id: string; folderName: string }>();
  const router = useRouter();
  const [name, setName] = useState(folderName);
  const insets = useSafeAreaInsets();

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert('Enter a name');
      return;
    }
    await updateFolderName(folderId, trimmed);
    router.back();
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Rename folder</Text>
      </View>
      <View style={styles.body}>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          autoFocus
          selectTextOnFocus
          maxLength={40}
          returnKeyType="done"
          onSubmitEditing={handleSave}
          placeholderTextColor={Colors.textMuted}
        />
        <Pressable
          style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.8 }]}
          onPress={handleSave}
        >
          <Text style={styles.saveBtnText}>Save</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  title: { ...Typography.subheading },
  body: { padding: Spacing.md, gap: Spacing.md },
  input: {
    height: 52,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    color: Colors.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  saveBtn: {
    height: 52,
    backgroundColor: Colors.accent,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: { ...Typography.body, fontWeight: '700', color: Colors.white, fontSize: 16 },
});
