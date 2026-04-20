import { Colors, Radius } from "@/theme";
import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";

export default function IconButton({
  onPress,
  style,
  children,
}: {
  onPress: () => void;
  children: React.ReactNode;
  style?: Object[];
}) {
  return (
    <Pressable style={[styles.iconBtn, ...(style ?? [])]} onPress={onPress}>
      {typeof children === "string" ? <Text style={styles.iconBtnText}>{children}</Text> : children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtnText: {
    fontSize: 18,
  },
});
