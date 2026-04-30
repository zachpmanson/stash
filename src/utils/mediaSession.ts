import { NativeEventEmitter, NativeModules } from "react-native";

type StashMediaSessionNative = {
  startSession: (title: string, artist: string | null, album: string | null) => void;
  updateMeta: (title: string, artist: string | null, album: string | null) => void;
  setPlaying: (playing: boolean) => void;
  endSession: () => void;
  addListener: (eventName: string) => void;
  removeListeners: (count: number) => void;
};

const Native: StashMediaSessionNative | undefined = (
  NativeModules as { StashMediaSession?: StashMediaSessionNative }
).StashMediaSession;

const emitter = Native ? new NativeEventEmitter(Native as unknown as never) : null;

export function setupMediaSession(): Promise<void> {
  return Promise.resolve();
}

export async function startSilentSession(meta: {
  title: string;
  artist?: string;
  album?: string;
}) {
  Native?.startSession(meta.title, meta.artist ?? null, meta.album ?? null);
}

export async function setMediaPlaying(playing: boolean) {
  Native?.setPlaying(playing);
}

export async function updateMediaMeta(meta: {
  title: string;
  artist?: string;
  album?: string;
}) {
  Native?.updateMeta(meta.title, meta.artist ?? null, meta.album ?? null);
}

export async function endMediaSession() {
  Native?.endSession();
}

export type RemoteEventSubscription = { remove: () => void };

export function subscribeRemoteEvents(handlers: {
  onToggle: () => void;
  onNext: () => void;
  onPrev: () => void;
}): RemoteEventSubscription[] {
  if (!emitter) return [];
  return [
    emitter.addListener("StashMediaToggle", handlers.onToggle),
    emitter.addListener("StashMediaNext", handlers.onNext),
    emitter.addListener("StashMediaPrev", handlers.onPrev),
  ];
}
