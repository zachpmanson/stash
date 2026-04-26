import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Pressable, ScrollView } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { MaterialIcons } from "@expo/vector-icons";
import { Colors, Spacing, Typography, Radius } from "../theme";
import Screen from "../components/Screen";
import { StashItem } from "../types";
import { getItemById } from "../db/items";
import { fetchArticle } from "../utils/readability";
import { normalizeText, splitSentences } from "../utils/sentences";
import { useSpeechPlayer } from "../hooks/useSpeechPlayer";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
    if (!item || item.type !== "url") return;
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

  return (
    <Screen options={{ title: "Listen" }}>
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

const WORDS_PER_SECOND = 2.5;

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function formatRemaining(seconds: number): string {
  if (seconds < 60) return "<1 min left";
  const mins = Math.round(seconds / 60);
  return `${mins} min left`;
}

function Player({ title, sentences }: { title: string | null; sentences: string[] }) {
  const meta = useMemo(() => ({ title: title ?? "Article", artist: "Stash" }), [title]);
  const player = useSpeechPlayer(sentences, meta);
  const scrollRef = useRef<ScrollView>(null);
  const offsetsRef = useRef<number[]>([]);
  const scrollHeightRef = useRef(0);

  const wordsPerSentence = useMemo(() => sentences.map(countWords), [sentences]);
  const totalWords = useMemo(() => wordsPerSentence.reduce((a, b) => a + b, 0), [wordsPerSentence]);
  const wordsRemaining = useMemo(() => {
    let n = 0;
    for (let i = player.index; i < wordsPerSentence.length; i++) n += wordsPerSentence[i];
    return n;
  }, [wordsPerSentence, player.index]);
  const percent = totalWords === 0 ? 0 : Math.round(((totalWords - wordsRemaining) / totalWords) * 100);
  const secondsLeft = Math.round(wordsRemaining / WORDS_PER_SECOND);

  useEffect(() => {
    const y = offsetsRef.current[player.index];
    if (y == null || !scrollRef.current) return;
    const target = Math.max(0, y - scrollHeightRef.current / 3);
    scrollRef.current.scrollTo({ y: target, animated: true });
  }, [player.index]);

  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.playerRoot]}>
      <View style={{ padding: Spacing.sm, flex: 1 }}>
        {title && (
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
        )}
        <View style={styles.progressRow}>
          <Text style={styles.progressText}>{percent}%</Text>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${percent}%` }]} />
          </View>
          <Text style={styles.progressText}>{formatRemaining(secondsLeft)}</Text>
        </View>

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
        <ControlButton icon="skip-previous" onPress={player.prev} disabled={player.index === 0} />
        <ControlButton icon={player.isPlaying ? "pause" : "play-arrow"} onPress={player.toggle} big />
        <ControlButton icon="skip-next" onPress={player.next} disabled={player.index >= player.total - 1} />
      </View>
    </View>
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
  title: { ...Typography.subheading, marginBottom: Spacing.xs },
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
  },
  sentenceDim: {
    color: Colors.textMuted,
    fontWeight: "400",
  },

  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.lg,
    paddingVertical: Spacing.lg,
    backgroundColor: Colors.accentDim,
    // borderRadius: 10,
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
    width: 76,
    height: 76,
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  ctrlPressed: { opacity: 0.7 },
  ctrlDisabled: { opacity: 0.3 },
});
