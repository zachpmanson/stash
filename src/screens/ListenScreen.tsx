import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Pressable, ScrollView, Modal } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { MaterialIcons } from "@expo/vector-icons";
import { Colors, Spacing, Typography, Radius } from "../theme";
import Screen from "../components/Screen";
import OverflowMenu from "../components/OverflowMenu";
import { StashItem } from "../types";
import { getItemById } from "../db/items";
import { fetchArticle } from "../utils/readability";
import { normalizeText, splitSentences } from "../utils/sentences";
import { useSpeechPlayer } from "../hooks/useSpeechPlayer";
import { wordsToSeconds } from "../utils/speech";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useVoiceStore } from "../state/voiceState";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; title: string | null; sentences: string[] };

export default function ListenScreen() {
  const { id: itemId } = useLocalSearchParams<{ id: string }>();
  const [item, setItem] = useState<StashItem | null>(null);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    getItemById(itemId).then(setItem);
  }, [itemId]);

  useEffect(() => {
    if (!item) return;
    if (item.type === "text") {
      const sentences = splitSentences(normalizeText(item.uri));
      if (sentences.length === 0) {
        setState({ kind: "error", message: "No readable text found." });
        return;
      }
      setState({ kind: "ready", title: item.title ?? null, sentences });
      return;
    }
    if (item.type !== "url") return;
    let cancelled = false;
    setState({ kind: "loading" });
    fetchArticle(item.uri)
      .then(({ title, text }) => {
        if (cancelled) return;
        const sentences = splitSentences(normalizeText(text));
        if (sentences.length === 0) {
          setState({ kind: "error", message: "No readable text found." });
          return;
        }
        setState({ kind: "ready", title, sentences });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ kind: "error", message: err?.message ?? "Failed to load article" });
      });
    return () => {
      cancelled = true;
    };
  }, [item, reloadKey]);

  const sentences = useMemo(() => (state.kind === "ready" ? state.sentences : []), [state]);

  const [voiceMenuOpen, setVoiceMenuOpen] = useState(false);

  return (
    <Screen
      options={{ title: "Listen" }}
      buttons={[
        <OverflowMenu items={[{ title: "Voice", onPress: () => setVoiceMenuOpen(true) }]} />,
      ]}
    >
      <VoicePickerModal visible={voiceMenuOpen} onClose={() => setVoiceMenuOpen(false)} />
      {state.kind === "loading" && (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} />
          <Text style={styles.muted}>Loading article…</Text>
        </View>
      )}

      {state.kind === "error" && (
        <View style={styles.center}>
          <Text style={styles.errorText}>{state.message}</Text>
          <Pressable style={styles.retryBtn} onPress={() => setReloadKey((k) => k + 1)}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}

      {state.kind === "ready" && <Player title={state.title} sentences={sentences} />}
    </Screen>
  );
}

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function formatRemaining(seconds: number): string {
  if (seconds < 60) return "<1 min left";
  const mins = Math.round(seconds / 60);
  return `${mins} min left`;
}

function Player({ title, sentences }: { title: string | null; sentences: string[] }) {
  const scrollRef = useRef<ScrollView>(null);
  const offsetsRef = useRef<number[]>([]);
  const scrollHeightRef = useRef(0);

  const wordsPerSentence = useMemo(() => sentences.map(countWords), [sentences]);
  const totalWords = useMemo(() => wordsPerSentence.reduce((a, b) => a + b, 0), [wordsPerSentence]);
  const secondsAt = useMemo(() => {
    const arr: number[] = new Array(wordsPerSentence.length);
    let cum = 0;
    for (let i = 0; i < wordsPerSentence.length; i++) {
      arr[i] = wordsToSeconds(cum);
      cum += wordsPerSentence[i];
    }
    return arr;
  }, [wordsPerSentence]);
  const totalSeconds = wordsToSeconds(totalWords);

  const meta = useMemo(
    () => ({ title: title ?? "Article", artist: "Stash", totalSeconds, secondsAt }),
    [title, totalSeconds, secondsAt],
  );
  const player = useSpeechPlayer(sentences, meta);

  const wordsRemaining = useMemo(() => {
    let n = 0;
    for (let i = player.index; i < wordsPerSentence.length; i++) n += wordsPerSentence[i];
    return n;
  }, [wordsPerSentence, player.index]);
  const percent = totalWords === 0 ? 0 : Math.round(((totalWords - wordsRemaining) / totalWords) * 100);
  const secondsLeft = Math.round(wordsToSeconds(wordsRemaining));

  useEffect(() => {
    const y = offsetsRef.current[player.index];
    if (y == null || !scrollRef.current) return;
    const target = Math.max(0, y - scrollHeightRef.current / 3);
    scrollRef.current.scrollTo({ y: target, animated: true });
  }, [player.index]);

  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.playerRoot]}>
      <View style={{ padding: Spacing.sm, paddingTop: Spacing.lg, flex: 1 }}>
        {title && (
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
        )}

        <ScrollView
          ref={scrollRef}
          style={styles.sentenceScroll}
          contentContainerStyle={styles.sentenceContent}
          onLayout={(e) => {
            scrollHeightRef.current = e.nativeEvent.layout.height;
          }}
        >
          {sentences.map((text, i) => {
            const isCurrent = i === player.index;
            return (
              <Pressable
                key={i}
                onPress={() => player.jumpTo(i)}
                onLayout={(e) => {
                  offsetsRef.current[i] = e.nativeEvent.layout.y;
                }}
              >
                <Text style={[styles.sentence, !isCurrent && styles.sentenceDim]}>{text}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.controls}>
        <View style={styles.controlButtons}>
          <ControlButton icon="skip-previous" onPress={player.prev} disabled={player.index === 0} />
          <ControlButton icon={player.isPlaying ? "pause" : "play-arrow"} onPress={player.toggle} big />
          <ControlButton icon="skip-next" onPress={player.next} disabled={player.index >= player.total - 1} />
        </View>
        <View style={styles.progressRow}>
          <Text style={styles.progressText}>{percent}%</Text>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${percent}%` }]} />
          </View>
          <Text style={styles.progressText}>{formatRemaining(secondsLeft)}</Text>
        </View>
      </View>
    </View>
  );
}

function VoicePickerModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
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

function ControlButton({
  icon,
  onPress,
  disabled,
  big,
}: {
  icon: React.ComponentProps<typeof MaterialIcons>["name"];
  onPress: () => void;
  disabled?: boolean;
  big?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.ctrl,
        big && styles.ctrlBig,
        pressed && !disabled && styles.ctrlPressed,
        disabled && styles.ctrlDisabled,
      ]}
    >
      <MaterialIcons name={icon} size={big ? 40 : 28} color={big ? Colors.white : Colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.md,
    padding: Spacing.lg,
  },
  muted: { ...Typography.caption },
  errorText: { ...Typography.body, color: Colors.danger, textAlign: "center" },
  retryBtn: {
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderWidth: 1,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
  },
  retryText: { ...Typography.body },

  playerRoot: {
    flex: 1,
    // padding: Spacing.md
  },
  title: { ...Typography.subheading, paddingBottom: Spacing.xs },
  position: { ...Typography.caption, marginBottom: Spacing.md },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  progressText: { ...Typography.caption, minWidth: 56 },
  progressBar: {
    flex: 1,
    height: 4,
    backgroundColor: Colors.surface2,
    borderRadius: Radius.full,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: Colors.accent,
  },
  sentenceScroll: { flex: 1 },
  sentenceContent: {
    paddingVertical: Spacing.lg,
  },
  sentence: {
    fontSize: 16,
    lineHeight: 28,
    color: Colors.text,
    fontWeight: "500",
    marginBottom: Spacing.md,
    fontFamily: "serif",
  },
  sentenceDim: {
    color: Colors.textMuted,
    fontWeight: "400",
  },

  controls: {
    // paddingVertical: Spacing.lg,
    backgroundColor: Colors.accentDim,
    // borderRadius: 10,
    padding: Spacing.lg,
    paddingBottom: Spacing.sm,
    gap: 12,
  },
  controlButtons: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.lg,
  },
  ctrl: {
    width: 56,
    height: 56,
    borderRadius: Radius.full,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  ctrlBig: {
    width: 64,
    height: 64,
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  ctrlPressed: { opacity: 0.7 },
  ctrlDisabled: { opacity: 0.3 },

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
