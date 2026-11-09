import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet } from "react-native";
import type { SavedLoginState } from "../db/savedSyncLogin";
import { subscribeSavedStashLogin } from "../db/syncLogin";
import { subscribeStashSyncStatus, type StashSyncStatus } from "../db/syncClient";
import { Colors, Radius } from "../theme";
import { STASH_SYNC_DEV_TOOLS } from "../utils/syncBuildGate";
import { syncStatusIndicator } from "../utils/syncStatusIndicator";

export default function HomeSyncButton() {
  return STASH_SYNC_DEV_TOOLS ? <EnabledHomeSyncButton /> : null;
}

function EnabledHomeSyncButton() {
  const router = useRouter();
  const [status, setStatus] = useState<StashSyncStatus | null>(null);
  const [login, setLogin] = useState<SavedLoginState>({ busy: false });

  useEffect(() => {
    const unsubscribeStatus = subscribeStashSyncStatus(setStatus);
    const unsubscribeLogin = subscribeSavedStashLogin(setLogin);
    return () => { unsubscribeStatus(); unsubscribeLogin(); };
  }, []);

  const indicator = syncStatusIndicator(status, login);
  const syncing = indicator.icon === "sync";
  const rotation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!syncing) return;
    const animation = Animated.loop(Animated.timing(rotation, {
      toValue: 1,
      duration: 1000,
      easing: Easing.linear,
      useNativeDriver: true,
      isInteraction: false,
    }));
    animation.start();
    return () => {
      animation.stop();
      rotation.setValue(0);
    };
  }, [rotation, syncing]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Sync settings: ${indicator.label}`}
      accessibilityHint="Open sync settings"
      hitSlop={4}
      onPress={() => router.push("/settings/sync")}
      style={({ pressed }) => [styles.button, { backgroundColor: indicator.color }, pressed && styles.pressed]}
    >
      <Animated.View style={{ transform: [{ rotate: rotation.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "-360deg"] }) }] }}>
        <MaterialIcons name={indicator.icon} size={22} color={Colors.bg} accessible={false} importantForAccessibility="no" />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: 40, height: 40, borderRadius: Radius.full, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.7 },
});
