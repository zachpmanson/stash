import React, { useEffect, useState, useCallback } from 'react';
import { StatusBar, BackHandler } from 'react-native';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ShareMenu from 'react-native-share-menu';

import { Colors } from './src/theme';
import { getDb } from './src/db/database';
import { ShareData } from './src/types';
import { ShareProvider, useShare } from './src/context/ShareContext';
import { RootStackParamList } from './src/navigation/types';

import HomeScreen from './src/screens/HomeScreen';
import FolderScreen from './src/screens/FolderScreen';
import ItemDetailScreen from './src/screens/ItemDetailScreen';
import ArchiveScreen from './src/screens/ArchiveScreen';
import MoveItemScreen from './src/screens/MoveItemScreen';
import EditFolderScreen from './src/screens/EditFolderScreen';
import ShareScreen from './src/screens/ShareScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

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

function AppContent() {
  const { pendingShare, setPendingShare, clearShare } = useShare();
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    getDb().then(() => setDbReady(true));
  }, []);

  useEffect(() => {
    if (!dbReady) return;

    ShareMenu.getInitialShare((data: ShareData | null) => {
      if (data?.data) setPendingShare(data);
    });

    const listener = ShareMenu.addNewShareListener((data: ShareData | null) => {
      if (data?.data) setPendingShare(data);
    });

    return () => listener?.remove?.();
  }, [dbReady, setPendingShare]);

  const handleSaved = useCallback(() => {
    clearShare();
    BackHandler.exitApp();
  }, [clearShare]);

  const handleDismiss = useCallback(() => {
    clearShare();
    BackHandler.exitApp();
  }, [clearShare]);

  if (!dbReady) return null;

  return (
    <>
      {/* Main navigation — always rendered */}
      <NavigationContainer theme={NAV_THEME}>
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: Colors.surface },
            headerTintColor: Colors.text,
            headerTitleStyle: { fontWeight: '600' },
            contentStyle: { backgroundColor: Colors.bg },
          }}
        >
          <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Folder" component={FolderScreen} options={({ route }) => ({ title: (route.params as { folderName: string }).folderName })} />
          <Stack.Screen name="ItemDetail" component={ItemDetailScreen} options={{ title: '' }} />
          <Stack.Screen name="Archive" component={ArchiveScreen} options={{ headerShown: false }} />
          <Stack.Screen name="MoveItem" component={MoveItemScreen} options={{ title: 'Add to folders', presentation: 'modal' }} />
          <Stack.Screen name="EditFolder" component={EditFolderScreen} options={{ title: 'Rename', presentation: 'modal' }} />
        </Stack.Navigator>
      </NavigationContainer>

      {pendingShare && (
        <ShareScreen
          shareData={pendingShare}
          onSaved={handleSaved}
          onDismiss={handleDismiss}
        />
      )}
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ShareProvider>
        <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />
        <AppContent />
      </ShareProvider>
    </SafeAreaProvider>
  );
}
