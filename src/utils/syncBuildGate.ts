import { Platform } from "react-native";

// Legacy export name retained for compatibility; sync is available in every Android
// build, not just development builds. CR-SQLite is not packaged on iOS or web.
export const STASH_SYNC_DEV_TOOLS = Platform.OS === "android";
