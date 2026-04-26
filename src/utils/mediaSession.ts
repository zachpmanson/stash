import { File, Paths } from 'expo-file-system';

type TrackPlayerModule = typeof import('react-native-track-player');

const SAMPLE_RATE = 8000;

function buildSilentWav(seconds: number): Uint8Array {
  const dataSize = SAMPLE_RATE * seconds; // 8-bit mono = 1 byte/sample
  const buf = new Uint8Array(44 + dataSize);
  const dv = new DataView(buf.buffer);
  buf[0] = 0x52; buf[1] = 0x49; buf[2] = 0x46; buf[3] = 0x46; // "RIFF"
  dv.setUint32(4, 36 + dataSize, true);
  buf[8] = 0x57; buf[9] = 0x41; buf[10] = 0x56; buf[11] = 0x45; // "WAVE"
  buf[12] = 0x66; buf[13] = 0x6d; buf[14] = 0x74; buf[15] = 0x20; // "fmt "
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, SAMPLE_RATE, true);
  dv.setUint32(28, SAMPLE_RATE, true); // byte rate
  dv.setUint16(32, 1, true); // block align
  dv.setUint16(34, 8, true); // bits per sample
  buf[36] = 0x64; buf[37] = 0x61; buf[38] = 0x74; buf[39] = 0x61; // "data"
  dv.setUint32(40, dataSize, true);
  buf.fill(0x80, 44); // 8-bit unsigned PCM silence is 128
  return buf;
}

function getSilentWavUri(seconds: number): string {
  const rounded = Math.max(60, Math.ceil(seconds));
  const file = new File(Paths.cache, `stash-silent-${rounded}.wav`);
  if (!file.exists) {
    file.create();
    file.write(buildSilentWav(rounded));
  }
  return file.uri;
}

let tp: TrackPlayerModule | null | false = null;

function getTP(): TrackPlayerModule | null {
  if (tp === false) return null;
  if (tp) return tp;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    tp = require('react-native-track-player');
    return tp as TrackPlayerModule;
  } catch (e) {
    console.warn('react-native-track-player unavailable:', e);
    tp = false;
    return null;
  }
}

let setupPromise: Promise<void> | null = null;

export function setupMediaSession(): Promise<void> {
  const m = getTP();
  if (!m) return Promise.resolve();
  const TrackPlayer = m.default;
  if (!setupPromise) {
    setupPromise = (async () => {
      try {
        await TrackPlayer.setupPlayer({ autoHandleInterruptions: true });
      } catch (e: any) {
        if (!String(e?.message ?? e).includes('already been initialized')) throw e;
      }
      await TrackPlayer.updateOptions({
        android: {
          appKilledPlaybackBehavior: m.AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
        },
        capabilities: [
          m.Capability.Play,
          m.Capability.Pause,
          m.Capability.SkipToNext,
          m.Capability.SkipToPrevious,
          m.Capability.Stop,
        ],
        notificationCapabilities: [
          m.Capability.Play,
          m.Capability.Pause,
          m.Capability.SkipToNext,
          m.Capability.SkipToPrevious,
        ],
      });
    })();
  }
  return setupPromise;
}

export async function startSilentSession(meta: {
  title: string;
  artist?: string;
  totalSeconds: number;
}) {
  const m = getTP();
  if (!m) return;
  const TrackPlayer = m.default;
  try {
    await setupMediaSession();
    // Pad by 50% so a slow listener doesn't run out of silent track
    const paddedSeconds = Math.ceil(meta.totalSeconds * 1.5);
    const url = getSilentWavUri(paddedSeconds);
    await TrackPlayer.reset();
    await TrackPlayer.add({
      id: 'stash-listen',
      url,
      title: meta.title,
      artist: meta.artist ?? 'Stash',
      duration: paddedSeconds,
    });
    await TrackPlayer.setRepeatMode(m.RepeatMode.Off);
    await TrackPlayer.play();
  } catch (e) {
    console.warn('startSilentSession failed:', e);
  }
}

export async function seekMediaSession(seconds: number) {
  const m = getTP();
  if (!m) return;
  try {
    await m.default.seekTo(seconds);
  } catch {
    // ignore
  }
}

export async function setMediaPlaying(playing: boolean) {
  const m = getTP();
  if (!m) return;
  try {
    if (playing) await m.default.play();
    else await m.default.pause();
  } catch {
    // ignore
  }
}

export async function updateMediaMeta(meta: { title: string; artist?: string }) {
  const m = getTP();
  if (!m) return;
  try {
    await m.default.updateMetadataForTrack(0, {
      title: meta.title,
      artist: meta.artist ?? 'Stash',
    });
  } catch {
    // queue may not be set up yet
  }
}

export async function endMediaSession() {
  const m = getTP();
  if (!m) return;
  try {
    await m.default.reset();
  } catch {
    // ignore
  }
}

export type RemoteEventSubscription = { remove: () => void };

export function subscribeRemoteEvents(handlers: {
  onToggle: () => void;
  onNext: () => void;
  onPrev: () => void;
}): RemoteEventSubscription[] {
  const m = getTP();
  if (!m) return [];
  try {
    const TP = m.default;
    return [
      TP.addEventListener(m.Event.RemotePlay, handlers.onToggle),
      TP.addEventListener(m.Event.RemotePause, handlers.onToggle),
      TP.addEventListener(m.Event.RemoteNext, handlers.onNext),
      TP.addEventListener(m.Event.RemotePrevious, handlers.onPrev),
    ];
  } catch (e) {
    console.warn('subscribeRemoteEvents failed:', e);
    return [];
  }
}
