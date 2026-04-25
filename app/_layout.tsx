import React, { useEffect, useRef } from "react";
import { StatusBar } from "react-native";
import { Stack, useRouter } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider, DarkTheme } from "@react-navigation/native";
import { useIncomingShare } from "expo-sharing";
import { Colors } from "../src/theme";
import { SnackbarHost } from "../src/components/SnackbarHost";

const NAV_THEME = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: Colors.bg,
    card: Colors.surface,
    text: Colors.text,
    border: Colors.border,
    primary: Colors.accent,
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
          contentStyle: { backgroundColor: Colors.bg },
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
        <Stack.Screen name="move-item/[id]" options={{ title: "Add to folders", presentation: "modal" }} />
        <Stack.Screen name="edit-folder/[id]" options={{ title: "Rename", presentation: "modal" }} />
      </Stack>
    </ThemeProvider>
  );
}

export default function App() {
  return (
    // <ShareIntentProvider>
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />
      <RootLayout />
      <SnackbarHost />
    </SafeAreaProvider>
    // </ShareIntentProvider>
  );
}
