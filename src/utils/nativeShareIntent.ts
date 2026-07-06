import { NativeModules, Platform } from "react-native";

const { ShareIntentModule } = NativeModules;

export function clearNativeShareIntent() {
  if (Platform.OS === "android") {
    ShareIntentModule?.clearIntent();
  }
}

export function finishShareTask() {
  if (Platform.OS === "android") {
    ShareIntentModule?.finishTask();
  }
}

const SHARE_ACTIONS = new Set(["android.intent.action.SEND", "android.intent.action.SEND_MULTIPLE"]);

export function isShareLaunch(): boolean {
  if (Platform.OS !== "android") return false;
  const action = ShareIntentModule?.getConstants?.()?.launchAction ?? ShareIntentModule?.launchAction;
  return typeof action === "string" && SHARE_ACTIONS.has(action);
}

// True when the share sheet entry was the dedicated "Stash: Listen" target
// (see plugins/share-intent-module), which should skip the folder picker
// and jump straight into the Listen screen. Reads the activity's intent
// fresh via a native method call rather than getConstants(), since
// getConstants() is snapshotted once at module init and goes stale across
// repeated shares while the app process stays alive (onNewIntent).
export async function isListenShareLaunch(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  const info = await ShareIntentModule?.getLaunchInfo?.();
  const className = info?.componentClassName;
  return typeof className === "string" && className.endsWith(".ListenShareActivity");
}
