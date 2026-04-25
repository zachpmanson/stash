import React from "react";
import { View, StyleSheet, ViewStyle, StyleProp } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Stack } from "expo-router";
import { Colors } from "../theme";

type StackScreenOptions = React.ComponentProps<typeof Stack.Screen>["options"];

type ScreenProps = {
  children: React.ReactNode;
  title?: string;
  options?: StackScreenOptions;
  style?: StyleProp<ViewStyle>;
  applyTopInset?: boolean;
};

export default function Screen({
  children,
  title,
  options,
  style,
  applyTopInset = true,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const mergedOptions = title ? { title, ...options } : options;

  return (
    <View style={[styles.container, applyTopInset && { paddingTop: insets.top }, style]}>
      {mergedOptions && <Stack.Screen options={mergedOptions} />}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
});
