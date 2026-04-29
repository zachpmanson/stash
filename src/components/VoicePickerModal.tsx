import React, { useEffect, useMemo, useRef } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { Colors, Radius, Spacing, Typography } from "../theme";
import { useVoiceStore } from "../state/voiceState";

export default function VoicePickerModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const voices = useVoiceStore((s) => s.voices);
  const selected = useVoiceStore((s) => s.selectedVoice);
  const setSelected = useVoiceStore((s) => s.setSelectedVoice);
  const loadVoices = useVoiceStore((s) => s.loadVoices);
  const loaded = useVoiceStore((s) => s.loaded);

  const scrollRef = useRef<ScrollView>(null);
  const offsetsRef = useRef<Record<string, number>>({});
  const scrollHeightRef = useRef(0);

  useEffect(() => {
    loadVoices();
  }, [loadVoices]);

  const sorted = useMemo(() => {
    return [...voices].sort((a, b) => {
      if (a.language !== b.language) return a.language.localeCompare(b.language);
      return a.name.localeCompare(b.name);
    });
  }, [voices]);

  useEffect(() => {
    if (!visible || !loaded) return;
    const tryScroll = () => {
      const y = offsetsRef.current[selected];
      if (y == null || !scrollRef.current) return false;
      const target = Math.max(0, y - scrollHeightRef.current / 2);
      scrollRef.current.scrollTo({ y: target, animated: false });
      return true;
    };
    if (!tryScroll()) {
      const t = setTimeout(tryScroll, 50);
      return () => clearTimeout(t);
    }
  }, [visible, loaded, selected, sorted]);

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.menuBackdrop} onPress={onClose}>
        <Pressable style={styles.voiceMenu} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.voiceMenuTitle}>Voice</Text>
          <ScrollView
            ref={scrollRef}
            style={{ maxHeight: 420 }}
            onLayout={(e) => {
              scrollHeightRef.current = e.nativeEvent.layout.height;
            }}
          >
            {!loaded && (
              <View style={styles.voiceLoading}>
                <ActivityIndicator color={Colors.accent} />
                <Text style={styles.voiceEmpty}>Loading voices…</Text>
              </View>
            )}
            {loaded && sorted.length === 0 && <Text style={styles.voiceEmpty}>No voices available</Text>}
            {sorted.map((v) => {
              const isSelected = v.identifier === selected;
              return (
                <Pressable
                  key={v.identifier}
                  style={styles.voiceItem}
                  onLayout={(e) => {
                    offsetsRef.current[v.identifier] = e.nativeEvent.layout.y;
                  }}
                  onPress={() => {
                    setSelected(v.identifier);
                    onClose();
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.voiceName}>{v.name}</Text>
                    <Text style={styles.voiceMeta}>
                      {v.language}
                      {v.quality ? ` · ${v.quality}` : ""}
                    </Text>
                  </View>
                  {isSelected && <MaterialIcons name="check" size={18} color={Colors.accent} />}
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  menuBackdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.lg,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  voiceMenu: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    width: "100%",
    maxWidth: 420,
    paddingVertical: Spacing.sm,
  },
  voiceMenuTitle: {
    ...Typography.caption,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    color: Colors.textMuted,
  },
  voiceItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
  },
  voiceName: { ...Typography.body, fontSize: 14 },
  voiceMeta: { ...Typography.caption, fontSize: 11 },
  voiceEmpty: {
    ...Typography.caption,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  voiceLoading: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.lg,
    gap: Spacing.sm,
  },
});
