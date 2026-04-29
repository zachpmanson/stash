import React, { useEffect, useRef } from "react";
import { StatusBar } from "react-native";
import { Stack, useRouter } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider, DarkTheme } from "@react-navigation/native";
import { PaperProvider, MD3DarkTheme } from "react-native-paper";
import { useIncomingShare } from "expo-sharing";
import { Colors } from "../src/theme";
import { SnackbarHost } from "../src/components/SnackbarHost";
import { ModalHost } from "../src/components/ModalHost";
import { isShareLaunch } from "../src/utils/nativeShareIntent";

const SHARE_LAUNCH = isShareLaunch();

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const TrackPlayer = require("react-native-track-player").default;
  if (TrackPlayer?.registerPlaybackService) {
    TrackPlayer.registerPlaybackService(() => require("../service").default);
  }
} catch (e) {
  console.warn("TrackPlayer registration failed:", e);
}

const NAV_THEME = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: SHARE_LAUNCH ? "transparent" : Colors.bg,
    card: Colors.surface,
    text: Colors.text,
    border: Colors.border,
    primary: Colors.accent,
  },
};

const PAPER_THEME = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: Colors.accent,
    background: Colors.bg,
    surface: Colors.surface,
    onSurface: Colors.text,
    inverseSurface: Colors.surface2,
    inverseOnSurface: Colors.text,
    outline: Colors.border,
  },
};

function RootLayout() {
  const router = useRouter();
  const { resolvedSharedPayloads } = useIncomingShare();
  const handledSigRef = useRef<string | null>(null);

  useEffect(() => {
    if (resolvedSharedPayloads.length === 0) return;
    const sig = JSON.stringify(resolvedSharedPayloads.map((p: any) => p.contentUri ?? p.value ?? p.text ?? ""));
    if (handledSigRef.current === sig) return;
    handledSigRef.current = sig;
    router.push("/share");
  }, [resolvedSharedPayloads]);

  return (
    <ThemeProvider value={NAV_THEME}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: Colors.surface },
          headerTintColor: Colors.text,
          headerTitleStyle: { fontWeight: "600" },
          contentStyle: { backgroundColor: SHARE_LAUNCH ? "transparent" : Colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="archive" options={{ title: "Archive" }} />
        <Stack.Screen
          name="share"
          options={{ headerShown: false, presentation: "transparentModal", animation: "fade" }}
        />
        <Stack.Screen name="folder/[id]" />
        <Stack.Screen name="item/[id]" options={{ title: "" }} />
        <Stack.Screen name="listen/[id]" options={{ title: "Listen" }} />
        <Stack.Screen name="move-item/[id]" options={{ title: "Add to folders", presentation: "modal" }} />
        <Stack.Screen name="edit-folder/[id]" options={{ title: "Edit Folder", presentation: "modal" }} />
      </Stack>
    </ThemeProvider>
  );
}

export default function App() {
  return (
    // <ShareIntentProvider>
    <SafeAreaProvider>
      <PaperProvider theme={PAPER_THEME}>
        <StatusBar
          barStyle="light-content"
          backgroundColor={SHARE_LAUNCH ? "transparent" : Colors.bg}
          translucent={SHARE_LAUNCH}
        />
        <RootLayout />
        <SnackbarHost />
        <ModalHost />
      </PaperProvider>
    </SafeAreaProvider>
    // </ShareIntentProvider>
  );
}
