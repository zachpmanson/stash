import React, { useEffect, useRef } from 'react';
import { StatusBar } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, DarkTheme } from '@react-navigation/native';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
import { Colors } from '../src/theme';
import { getDb } from '../src/db/database';

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
  const { hasShareIntent } = useShareIntentContext();
  const dbReady = useRef(false);

  useEffect(() => {
    getDb().then(() => {
      dbReady.current = true;
      if (hasShareIntent) {
        router.replace('/share');
      }
    });
  }, []);

  useEffect(() => {
    if (dbReady.current && hasShareIntent) {
      router.replace('/share');
    }
  }, [hasShareIntent]);

  return (
    <ThemeProvider value={NAV_THEME}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: Colors.surface },
          headerTintColor: Colors.text,
          headerTitleStyle: { fontWeight: '600' },
          contentStyle: { backgroundColor: Colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="archive" options={{ headerShown: false }} />
        <Stack.Screen name="share" options={{ headerShown: false }} />
        <Stack.Screen name="folder/[id]" />
        <Stack.Screen name="item/[id]" options={{ title: '' }} />
        <Stack.Screen name="move-item/[id]" options={{ title: 'Add to folders', presentation: 'modal' }} />
        <Stack.Screen name="edit-folder/[id]" options={{ title: 'Rename', presentation: 'modal' }} />
      </Stack>
    </ThemeProvider>
  );
}

export default function App() {
  return (
    <ShareIntentProvider>
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />
        <RootLayout />
      </SafeAreaProvider>
    </ShareIntentProvider>
  );
}
