import { MaterialIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useArticle } from "src/hooks/useArticle";
import OverflowMenu from "../components/OverflowMenu";
import Screen from "../components/Screen";
import TopbarButton from "../components/TopbarButton";
import VoicePickerModal from "../components/VoicePickerModal";
import { archiveItem, getItemById, updateItemListenedPercent } from "../db/items";
import { getTextSubstitutions } from "../db/textSubstitutions";
import { useSpeechPlayer } from "../hooks/useSpeechPlayer";
import { useListenSession } from "../state/listenSession";
import { showModal } from "../state/modalState";
import { Colors, Radius, Spacing, Typography } from "../theme";
import { StashItem } from "../types";
import { normalizeText, Sentence, splitSentences } from "../utils/sentences";
import { VoiceMode } from "../utils/readability";
import { wordsToSeconds } from "../utils/speech";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; title: string | null; sentences: Sentence[] };

export default function ListenScreen() {
  const router = useRouter();
  const { id: itemId } = useLocalSearchParams<{ id: string }>();
  const [item, setItem] = useState<StashItem | null>(null);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  const { state: articleState, sentences } = useArticle(
    item?.type === "url" ? item.uri : undefined,
    item?.id,
    item?.article_text,
    item?.article_html,
  );

  useEffect(() => {
    getItemById(itemId).then(setItem);
  }, [itemId]);

  useEffect(() => {
    useListenSession.getState().setActiveItemId(itemId);
    return () => useListenSession.getState().setActiveItemId(null);
  }, [itemId]);

  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    if (item.type === "text") {
      setState({ kind: "loading" });
      getTextSubstitutions().then((subs) => {
        if (cancelled) return;
        const sentences: Sentence[] = splitSentences(normalizeText(item.uri)).map((text) => ({
          text,
          mode: "primary" as const,
        }));
        if (sentences.length === 0) {
          setState({ kind: "error", message: "No readable text found." });
          return;
        }
        setState({ kind: "ready", title: item.title ?? null, sentences });
      });
      return () => {
        cancelled = true;
      };
    }
    if (item.type !== "url") return;

    setState({ kind: "loading" });
    if (sentences && articleState.kind === "ready") {
      console.log(item.title);
      setState({
        kind: "ready",
        sentences: sentences,
        title: item.title,
      });
    }
    // Promise.all([fetchArticle(item.uri), getTextSubstitutions()])
    //   .then(([{ title, html }, subs]) => {
    //     if (cancelled) return;
    //     const sentences = splitSentences(applySubstitutions(normalizeText(htmlToText(html)), subs));
    //     if (sentences.length === 0) {
    //       setState({ kind: "error", message: "No readable text found." });
    //       return;
    //     }
    //     setState({ kind: "ready", title, sentences });
    //   })
    //   .catch((err) => {
    //     if (cancelled) return;
    //     setState({ kind: "error", message: err?.message ?? "Failed to load article" });
    //   });
    return () => {
      cancelled = true;
    };
  }, [item, reloadKey, sentences, articleState]);

  const sentencesWithTitle = useMemo<Sentence[]>(() => {
    if (state.kind === "ready") {
      const titleSentence: Sentence[] = state.title ? [{ text: state.title, mode: "primary" }] : [];
      return [...titleSentence, ...state.sentences];
    }
    return [];
  }, [state]);

  const [voiceMenu, setVoiceMenu] = useState<VoiceMode | null>(null);

  const handleArchive = useCallback(() => {
    if (!item) return;
    showModal({
      title: "Archive item?",
      message: "You can unarchive it later.",
      buttons: [
        { text: "Cancel", style: "cancel" },
        {
          text: "Archive",
          style: "destructive",
          onPress: async () => {
            await archiveItem(item.id);
            router.back();
          },
        },
      ],
    });
  }, [item, router]);

  return (
    <Screen
      options={{ title: "Listen" }}
      buttons={[
        <TopbarButton key="archive" onPress={handleArchive}>
          <MaterialIcons name="archive" size={22} color="white" />
        </TopbarButton>,
        <OverflowMenu
          key="overflow"
          items={[
            { title: "Narrator voice", onPress: () => setVoiceMenu("primary") },
            { title: "Quote voice", onPress: () => setVoiceMenu("quote") },
            { title: "Text Substitutions", onPress: () => router.push("/text-substitutions") },
          ]}
        />,
      ]}
    >
      <VoicePickerModal
        visible={voiceMenu !== null}
        mode={voiceMenu ?? "primary"}
        onClose={() => setVoiceMenu(null)}
      />
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

      {state.kind === "ready" && (
        <Player
          title={state.title}
          sentences={sentencesWithTitle}
          itemId={itemId}
          initialPercent={item?.listened_percent ?? 0}
        />
      )}
    </Screen>
  );
}

function countWords(s: Sentence): number {
  return s.text.trim().split(/\s+/).filter(Boolean).length;
}

function formatRemaining(seconds: number): string {
  if (seconds < 60) return "<1 min left";
  const mins = Math.round(seconds / 60);
  return `${mins} min left`;
}

function Player({
  title,
  sentences,
  itemId,
  initialPercent,
}: {
  title: string | null;
  sentences: Sentence[];
  itemId: string;
  initialPercent: number;
}) {
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

  const initialIndex = useMemo(() => {
    if (initialPercent <= 0 || totalWords === 0) return 0;
    const targetWords = (initialPercent / 100) * totalWords;
    let cum = 0;
    for (let i = 0; i < wordsPerSentence.length; i++) {
      if (cum >= targetWords) return i;
      cum += wordsPerSentence[i];
    }
    return Math.max(0, wordsPerSentence.length - 1);
    // initialPercent intentionally only consulted on first mount via useSpeechPlayer's lazy init
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const player = useSpeechPlayer(sentences, meta, itemId, initialIndex);

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

  useEffect(() => {
    if (!itemId) return;
    updateItemListenedPercent(itemId, percent).catch(() => {});
  }, [itemId, percent]);

  return (
    <View style={[styles.playerRoot]}>
      <View style={{ flex: 1 }}>
        <ScrollView
          ref={scrollRef}
          style={styles.sentenceScroll}
          contentContainerStyle={styles.sentenceContent}
          onLayout={(e) => {
            scrollHeightRef.current = e.nativeEvent.layout.height;
          }}
        >
          {sentences.map((s, i) => {
            const isCurrent = i === player.index;
            const isQuote = s.mode === "quote";
            return (
              <Pressable
                key={i}
                onPress={() => player.jumpTo(i)}
                onLayout={(e) => {
                  offsetsRef.current[i] = e.nativeEvent.layout.y;
                }}
              >
                <Text
                  style={[
                    styles.sentence,
                    isQuote && styles.sentenceQuote,
                    !isCurrent && styles.sentenceDim,
                  ]}
                >
                  {s.text}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.controls}>
        {title && (
          <View
            style={
              {
                // backgroundColor: Colors.accentDim,
                // padding: Spacing.sm,
                // paddingTop: Spacing.lg,
              }
            }
          >
            <Text style={[styles.title]} numberOfLines={2}>
              {title}
            </Text>
          </View>
        )}
        <View style={styles.controlButtons}>
          <ControlButton icon="skip-previous" onPress={player.prev} disabled={player.index === 0} />
          <ControlButton icon={player.isPlaying ? "pause" : "play-arrow"} onPress={player.toggle} big />
          <ControlButton icon="skip-next" onPress={player.next} disabled={player.index >= player.total - 1} />
        </View>
        <View style={[{ flexDirection: "column", alignContent: "stretch", gap: 12 }]}>
          <View style={styles.progressRow}>
            <Text style={styles.progressText}>{percent}%</Text>
            <Text style={styles.progressText}>{formatRemaining(secondsLeft)}</Text>
          </View>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${percent}%` }]} />
          </View>
        </View>
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
  title: { ...Typography.subheading, paddingBottom: Spacing.xs },
  position: { ...Typography.caption, marginBottom: Spacing.md },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    // gap: Spacing.sm,
    // marginBottom: Spacing.md,
  },
  progressText: { ...Typography.caption, minWidth: 56 },
  progressBar: {
    // flex: 1,
    height: 4,
    backgroundColor: Colors.surface2,
    borderRadius: Radius.full,
    overflow: "hidden",
    width: "100%",
  },
  progressFill: {
    height: "100%",
    backgroundColor: Colors.accent,
  },
  sentenceScroll: { flex: 1 },
  sentenceContent: {
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.sm,
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
  sentenceQuote: {
    fontStyle: "italic",
    paddingLeft: Spacing.md,
    borderLeftWidth: 2,
    borderLeftColor: Colors.border,
  },

  controls: {
    // paddingVertical: Spacing.lg,
    backgroundColor: Colors.accentDim,
    // borderRadius: 10,
    padding: Spacing.lg,
    paddingBottom: Spacing.lg,
    gap: 12,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
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
});
