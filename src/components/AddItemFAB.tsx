import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors, Radius, Spacing, Typography } from "src/theme";

export type AddItemMode = "url" | "text" | "image";

type Props = {
  onSelect: (mode: AddItemMode) => void;
  onNewFolder?: () => void;
};

const ITEM_OPTIONS: { mode: AddItemMode; emoji: string; label: string }[] = [
  { mode: "url", emoji: "🔗", label: "Link" },
  { mode: "text", emoji: "📝", label: "Text" },
  { mode: "image", emoji: "🖼️", label: "Image" },
];

const MINI_SIZE = 48;
const MAIN_SIZE = 56;
const STEP = MINI_SIZE + Spacing.md;

export default function AddItemFAB({ onSelect, onNewFolder }: Props) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;

  type Action = { key: string; emoji: string; label: string; onPress: () => void };
  const actions: Action[] = [
    ...ITEM_OPTIONS.map((opt) => ({
      key: opt.mode,
      emoji: opt.emoji,
      label: opt.label,
      onPress: () => onSelect(opt.mode),
    })),
    ...(onNewFolder
      ? [{ key: "folder", emoji: "📁", label: "Folder", onPress: onNewFolder }]
      : []),
  ];

  useEffect(() => {
    Animated.timing(anim, {
      toValue: open ? 1 : 0,
      duration: 180,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [open, anim]);

  const handleAction = (action: Action) => {
    setOpen(false);
    action.onPress();
  };

  const rotate = anim.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "45deg"] });

  return (
    <>
      {open && <Pressable style={styles.scrim} onPress={() => setOpen(false)} />}
      <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + Spacing.lg }]}>
        {actions.map((action, i) => {
          const offset = STEP * (actions.length - i);
          const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, -offset] });
          const opacity = anim;
          return (
            <Animated.View
              key={action.key}
              pointerEvents={open ? "auto" : "none"}
              style={[styles.miniRow, { opacity, transform: [{ translateY }] }]}
            >
              <View style={styles.labelPill}>
                <Text style={styles.labelText}>{action.label}</Text>
              </View>
              <Pressable
                onPress={() => handleAction(action)}
                style={({ pressed }) => [styles.mini, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`Add ${action.label}`}
              >
                <Text style={styles.miniEmoji}>{action.emoji}</Text>
              </Pressable>
            </Animated.View>
          );
        })}

        <Pressable
          onPress={() => setOpen((v) => !v)}
          style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={open ? "Close add menu" : "Add item"}
          hitSlop={8}
        >
          <Animated.Text style={[styles.plus, { transform: [{ rotate }] }]}>+</Animated.Text>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  wrap: {
    position: "absolute",
    right: Spacing.lg,
    alignItems: "flex-end",
  },
  miniRow: {
    position: "absolute",
    right: (MAIN_SIZE - MINI_SIZE) / 2,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  labelPill: {
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  labelText: {
    ...Typography.caption,
    color: Colors.text,
    fontWeight: "600",
  },
  mini: {
    width: MINI_SIZE,
    height: MINI_SIZE,
    borderRadius: Radius.full,
    backgroundColor: Colors.surface2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  miniEmoji: {
    fontSize: 22,
  },
  fab: {
    width: MAIN_SIZE,
    height: MAIN_SIZE,
    borderRadius: Radius.full,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  pressed: {
    opacity: 0.85,
  },
  plus: {
    color: Colors.white,
    fontSize: 32,
    fontWeight: "300",
    lineHeight: 36,
    marginTop: -2,
  },
});
