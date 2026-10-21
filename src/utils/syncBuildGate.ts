import { Platform } from "react-native";

// Keep direct env access: Expo inlines EXPO_PUBLIC_* at build time.
export const STASH_SYNC_DEV_TOOLS = Platform.OS === "android" &&
  (__DEV__ || process.env.EXPO_PUBLIC_STASH_SYNC_DEV_TOOLS === "1");
