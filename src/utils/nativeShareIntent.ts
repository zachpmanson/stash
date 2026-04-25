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
