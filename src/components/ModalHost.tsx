import React, { useCallback } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Colors, Radius, Spacing, Typography } from "src/theme";
import { ModalButton, useModalStore } from "src/state/modalState";

const DEFAULT_BUTTONS: ModalButton[] = [{ text: "OK", style: "default" }];

export function ModalHost() {
  const current = useModalStore((s) => s.current);
  const dismiss = useModalStore((s) => s.dismiss);

  const buttons = current?.buttons?.length ? current.buttons : DEFAULT_BUTTONS;
  const hasCancel = buttons.some((b) => b.style === "cancel");

  const handlePress = useCallback(
    async (btn: ModalButton) => {
      dismiss();
      await btn.onPress?.();
    },
    [dismiss],
  );

  const handleBackdrop = useCallback(() => {
    if (!current) return;
    const cancel = current.buttons?.find((b) => b.style === "cancel");
    if (cancel) {
      handlePress(cancel);
    } else {
      dismiss();
    }
  }, [current, dismiss, handlePress]);

  return (
    <Modal visible={!!current} transparent animationType="fade" onRequestClose={handleBackdrop}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <Pressable style={styles.overlay} onPress={handleBackdrop}>
          <Pressable style={styles.dialog} onPress={() => {}}>
            {!!current && (
              <>
                <Text style={styles.title}>{current.title}</Text>
                {!!current.message && <Text style={styles.body}>{current.message}</Text>}
                <View style={[styles.actions, !hasCancel && buttons.length === 1 && styles.actionsSingle]}>
                  {buttons.map((btn, i) => {
                    const isCancel = btn.style === "cancel";
                    const isDestructive = btn.style === "destructive";
                    return (
                      <Pressable
                        key={`${btn.text}-${i}`}
                        onPress={() => handlePress(btn)}
                        style={({ pressed }) => [
                          styles.btn,
                          isCancel && styles.btnCancel,
                          isDestructive && styles.btnDestructive,
                          !isCancel && !isDestructive && styles.btnPrimary,
                          pressed && styles.btnPressed,
                        ]}
                      >
                        <Text
                          style={[
                            styles.btnText,
                            isCancel && styles.btnTextCancel,
                            (isDestructive || !isCancel) && styles.btnTextOnFilled,
                          ]}
                        >
                          {btn.text}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  overlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.xl,
  },
  dialog: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    width: "100%",
    maxWidth: 420,
  },
  title: {
    ...Typography.subheading,
    marginBottom: Spacing.xs,
  },
  body: {
    ...Typography.body,
    color: Colors.textSecondary,
    marginBottom: Spacing.md,
    lineHeight: 22,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  actionsSingle: {
    justifyContent: "flex-end",
  },
  btn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.sm,
    minWidth: 72,
    alignItems: "center",
  },
  btnCancel: {
    backgroundColor: "transparent",
  },
  btnPrimary: {
    backgroundColor: Colors.accent,
  },
  btnDestructive: {
    backgroundColor: Colors.danger,
  },
  btnPressed: {
    opacity: 0.75,
  },
  btnText: {
    ...Typography.body,
    fontWeight: "600",
  },
  btnTextCancel: {
    color: Colors.textSecondary,
  },
  btnTextOnFilled: {
    color: Colors.white,
  },
});
