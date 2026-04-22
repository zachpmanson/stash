import { NativeModules, Platform } from "react-native";

const { ShareIntentModule } = NativeModules;

export function clearNativeShareIntent() {
  if (Platform.OS === "android") {
    ShareIntentModule?.clearIntent();
  }
}

export function setExcludeFromRecents(exclude: boolean) {
  if (Platform.OS === "android") {
    ShareIntentModule?.setExcludeFromRecents(exclude);
  }
}
