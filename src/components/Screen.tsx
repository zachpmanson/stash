import React from "react";
import { View, StyleSheet, ViewStyle, StyleProp, Pressable, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Stack } from "expo-router";
import { Colors, Spacing } from "../theme";
import { triggerScrollToTop } from "../state/scrollTopState";

type StackScreenOptions = React.ComponentProps<typeof Stack.Screen>["options"];

type ScreenProps = {
  children: React.ReactNode;
  title?: string;
  options?: StackScreenOptions;
  buttons?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  applyTopInset?: boolean;
};

export default function Screen({ children, title, options, style, buttons, applyTopInset = false }: ScreenProps) {
  const insets = useSafeAreaInsets();
  let mergedOptions = title
    ? {
        title,
        headerTitle: () => (
          <Pressable onPress={triggerScrollToTop} hitSlop={8}>
            <Text style={styles.headerTitle}>{title}</Text>
          </Pressable>
        ),
        ...options,
      }
    : options;
  mergedOptions = buttons
    ? { headerRight: () => <View style={styles.headerActions}>{buttons}</View>, ...mergedOptions }
    : mergedOptions;

  return (
    <View
      style={[styles.container, { paddingBottom: insets.bottom }, applyTopInset && { paddingTop: insets.top }, style]}
    >
      {mergedOptions && <Stack.Screen options={mergedOptions} />}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  headerTitle: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: "600",
  },
});
