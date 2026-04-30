type TrackPlayerModule = typeof import("react-native-track-player");

const SILENT_TRACK_URL =
  "data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSADAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==";

let tp: TrackPlayerModule | null | false = null;

function getTP(): TrackPlayerModule | null {
  if (tp === false) return null;
  if (tp) return tp;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    tp = require("react-native-track-player");
    return tp as TrackPlayerModule;
  } catch (e) {
    console.warn("react-native-track-player unavailable:", e);
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
        await TrackPlayer.setupPlayer({
          autoHandleInterruptions: true,
          androidAudioContentType: m.AndroidAudioContentType.Speech,
        });
      } catch (e: any) {
        if (!String(e?.message ?? e).includes("already been initialized")) throw e;
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

export async function startSilentSession(meta: { title: string; artist?: string; album?: string }) {
  const m = getTP();
  if (!m) return;
  const TrackPlayer = m.default;
  try {
    await setupMediaSession();
    await TrackPlayer.reset();
    await TrackPlayer.add({
      id: "stash-listen",
      url: "x",
      title: meta.title,
      artist: meta.artist ?? "Stash",
      album: meta.album,
    });
    await TrackPlayer.setRepeatMode(m.RepeatMode.Track);
    await TrackPlayer.play();
  } catch (e) {
    console.warn("startSilentSession failed:", e);
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

export async function updateMediaMeta(meta: { title: string; artist?: string; album?: string }) {
  const m = getTP();
  if (!m) return;
  try {
    await m.default.updateMetadataForTrack(0, {
      title: meta.title,
      artist: meta.artist ?? "Stash",
      album: meta.album,
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
    console.warn("subscribeRemoteEvents failed:", e);
    return [];
  }
}
