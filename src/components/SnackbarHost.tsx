import React from "react";
import { StyleSheet } from "react-native";
import { Snackbar } from "react-native-paper";
import { Colors, Spacing, Typography } from "src/theme";
import { useSnackbarStore, SnackbarVariant } from "src/state/snackbarState";

const DURATION_MS = 2800;

const variantColor = (v: SnackbarVariant) => {
  if (v === "success") return Colors.success;
  if (v === "error") return Colors.danger;
  return Colors.accent;
};

export function SnackbarHost() {
  const current = useSnackbarStore((s) => s.current);
  const hide = useSnackbarStore((s) => s.hide);

  return (
    <Snackbar
      key={current?.id}
      visible={!!current}
      onDismiss={hide}
      duration={DURATION_MS}
      style={[
        styles.bar,
        current && { borderLeftColor: variantColor(current.variant) },
      ]}
      theme={{ colors: { inverseOnSurface: Colors.text } }}
    >
      {current?.message ?? ""}
    </Snackbar>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: Colors.surface2,
    borderLeftWidth: 3,
    marginBottom: Spacing.lg,
    ...Typography.body,
  },
});
