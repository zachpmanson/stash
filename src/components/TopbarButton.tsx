import React from "react";
import { Platform, StyleSheet, Text } from "react-native";
import { PlatformPressable } from "@react-navigation/elements";
import { Radius, Spacing } from "../theme";

export default function TopbarButton({ onPress, children }: { onPress: () => void; children: React.ReactNode }) {
  return (
    <PlatformPressable
      onPress={onPress}
      android_ripple={{
        borderless: false,
        foreground: Platform.OS === "android" && Platform.Version >= 23,
      }}
      style={styles.btn}
    >
      {typeof children === "string" ? <Text style={styles.text}>{children}</Text> : children}
    </PlatformPressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radius.full,
    overflow: "hidden",
    paddingHorizontal: Spacing.xs,
  },
  text: { fontSize: 18 },
});
