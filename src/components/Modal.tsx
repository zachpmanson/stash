import React from "react";
import {
  KeyboardAvoidingView,
  Modal as RNModal,
  ModalProps as RNModalProps,
  Platform,
  Pressable,
  StyleSheet,
  View,
  ViewStyle,
} from "react-native";
import { Colors, Radius, Spacing } from "../theme";

type Props = {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  dismissOnBackdropPress?: boolean;
  contentStyle?: ViewStyle | ViewStyle[];
  animationType?: RNModalProps["animationType"];
};

export default function Modal({
  visible,
  onClose,
  children,
  dismissOnBackdropPress = true,
  contentStyle,
  animationType = "fade",
}: Props) {
  return (
    <RNModal transparent visible={visible} animationType={animationType} onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <Pressable
          style={styles.backdrop}
          onPress={dismissOnBackdropPress ? onClose : undefined}
        >
          <Pressable style={[styles.dialog, contentStyle]} onPress={(e) => e.stopPropagation()}>
            <View>{children}</View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.lg,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  dialog: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    width: "100%",
    maxWidth: 420,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
});
