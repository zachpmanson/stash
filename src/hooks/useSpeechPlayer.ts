import { useCallback, useEffect, useRef, useState } from "react";
import * as Speech from "expo-speech";
import {
  startSilentSession,
  setMediaPlaying,
  endMediaSession,
  updateMediaMeta,
  seekMediaSession,
  subscribeRemoteEvents,
} from "../utils/mediaSession";

export type SpeechPlayerMeta = {
  title: string;
  artist?: string;
  totalSeconds: number;
  secondsAt: number[];
};

export type SpeechPlayer = {
  index: number;
  isPlaying: boolean;
  total: number;
  current: string | null;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  jumpTo: (i: number) => void;
};

export function useSpeechPlayer(sentences: string[], meta?: SpeechPlayerMeta): SpeechPlayer {
  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);

  // Track the utterance generation to ignore stale onDone callbacks
  // (when we stop+restart, the previous utterance's onDone may still fire).
  const genRef = useRef(0);
  const indexRef = useRef(index);
  const sentencesRef = useRef(sentences);
  const isPlayingRef = useRef(false);
  const mediaStartedRef = useRef(false);
  const metaRef = useRef(meta);

  useEffect(() => {
    indexRef.current = index;
  }, [index]);
  useEffect(() => {
    sentencesRef.current = sentences;
  }, [sentences]);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  useEffect(() => {
    metaRef.current = meta;
  }, [meta]);

  useEffect(() => {
    if (!mediaStartedRef.current) return;
    const at = metaRef.current?.secondsAt[index];
    if (at != null) seekMediaSession(at);
  }, [index]);

  useEffect(() => {
    if (!meta) return;
    if (mediaStartedRef.current) {
      updateMediaMeta(meta);
    }
  }, [meta?.title, meta?.artist]);

  useEffect(() => {
    play();
    return () => {
      Speech.stop();
      endMediaSession();
    };
  }, []);

  const speakAt = useCallback((i: number) => {
    const list = sentencesRef.current;
    if (i < 0 || i >= list.length) {
      Speech.stop();
      setIsPlaying(false);
      setMediaPlaying(false);
      return;
    }
    genRef.current += 1;
    const myGen = genRef.current;
    Speech.stop();
    Speech.speak(list[i], {
      onDone: () => {
        if (myGen !== genRef.current) return;
        const nextI = indexRef.current + 1;
        if (nextI >= sentencesRef.current.length) {
          setIsPlaying(false);
          setMediaPlaying(false);
          return;
        }
        setIndex(nextI);
        speakAt(nextI);
      },
      onStopped: () => {
        if (myGen !== genRef.current) return;
      },
      onError: () => {
        if (myGen !== genRef.current) return;
        setIsPlaying(false);
        setMediaPlaying(false);
      },
    });
    setIsPlaying(true);
  }, []);

  const play = useCallback(() => {
    if (!mediaStartedRef.current && meta) {
      mediaStartedRef.current = true;
      startSilentSession(meta).catch(() => {
        mediaStartedRef.current = false;
      });
    } else {
      setMediaPlaying(true);
    }
    speakAt(indexRef.current);
  }, [speakAt, meta?.title, meta?.artist]);

  const pause = useCallback(() => {
    genRef.current += 1;
    Speech.stop();
    setIsPlaying(false);
    setMediaPlaying(false);
  }, []);

  const toggle = useCallback(() => {
    if (isPlaying) pause();
    else play();
  }, [isPlaying, play, pause]);

  const jumpTo = useCallback(
    (i: number) => {
      const clamped = Math.max(0, Math.min(sentencesRef.current.length - 1, i));
      setIndex(clamped);
      if (isPlaying) {
        speakAt(clamped);
      } else {
        genRef.current += 1;
        Speech.stop();
        play();
      }
    },
    [isPlaying, speakAt],
  );

  const next = useCallback(() => jumpTo(indexRef.current + 1), [jumpTo]);
  const prev = useCallback(() => jumpTo(indexRef.current - 1), [jumpTo]);

  const toggleRef = useRef<() => void>(() => {});
  const nextRef = useRef<() => void>(() => {});
  const prevRef = useRef<() => void>(() => {});
  useEffect(() => {
    toggleRef.current = () => (isPlayingRef.current ? pause() : play());
    nextRef.current = next;
    prevRef.current = prev;
  }, [play, pause, next, prev]);

  useEffect(() => {
    const subs = subscribeRemoteEvents({
      onToggle: () => toggleRef.current(),
      onNext: () => nextRef.current(),
      onPrev: () => prevRef.current(),
    });
    return () => {
      subs.forEach((s) => s.remove());
    };
  }, []);

  return {
    index,
    isPlaying,
    total: sentences.length,
    current: sentences[index] ?? null,
    play,
    pause,
    toggle,
    next,
    prev,
    jumpTo,
  };
}
