import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors, Radius, Spacing, Typography } from "src/theme";
import { useSnackbarStore, SnackbarVariant } from "src/state/snackbarState";

const DURATION_MS = 2800;

const variantColor = (v: SnackbarVariant) => {
  if (v === "success") return Colors.success;
  if (v === "error") return Colors.danger;
  return Colors.accent;
};

export function SnackbarHost() {
  const insets = useSafeAreaInsets();
  const current = useSnackbarStore((s) => s.current);
  const hide = useSnackbarStore((s) => s.hide);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    if (!current) return;
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start();

    const t = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 20, duration: 180, useNativeDriver: true }),
      ]).start(() => hide());
    }, DURATION_MS);

    return () => clearTimeout(t);
  }, [current?.id]);

  if (!current) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrap,
        { bottom: insets.bottom + Spacing.lg, opacity, transform: [{ translateY }] },
      ]}
    >
      <View style={[styles.bar, { borderLeftColor: variantColor(current.variant) }]}>
        <Text style={styles.text} numberOfLines={3}>
          {current.message}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: Spacing.md,
    right: Spacing.md,
    alignItems: "center",
  },
  bar: {
    minWidth: "60%",
    maxWidth: "100%",
    backgroundColor: Colors.surface2,
    borderRadius: Radius.md,
    borderLeftWidth: 3,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.md,
  },
  text: {
    ...Typography.body,
  },
});
