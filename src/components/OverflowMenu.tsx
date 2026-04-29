import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Menu } from "react-native-paper";
import { MaterialIcons } from "@expo/vector-icons";
import TopbarButton from "./TopbarButton";
import { Colors, Radius, Typography } from "../theme";

export type OverflowMenuItem = {
  title: string;
  onPress: () => void;
  leadingIcon?: React.ComponentProps<typeof MaterialIcons>["name"];
  trailing?: React.ReactNode;
  disabled?: boolean;
  destructive?: boolean;
};

type Props = {
  items: OverflowMenuItem[];
  icon?: React.ComponentProps<typeof MaterialIcons>["name"];
  anchor?: React.ReactNode;
};

export default function OverflowMenu({ items, icon = "more-vert", anchor }: Props) {
  const [visible, setVisible] = useState(false);
  const open = () => setVisible(true);
  const close = () => setVisible(false);

  const trigger = anchor ?? (
    <TopbarButton onPress={open}>
      <MaterialIcons name={icon} size={20} color={Colors.text} />
    </TopbarButton>
  );

  return (
    <Menu
      visible={visible}
      onDismiss={close}
      anchor={anchor ? <View onTouchEnd={open}>{anchor}</View> : trigger}
      contentStyle={styles.content}
    >
      {items.map((item, i) => (
        <Menu.Item
          key={i}
          onPress={() => {
            close();
            item.onPress();
          }}
          title={item.title}
          leadingIcon={item.leadingIcon}
          trailingIcon={item.trailing ? () => <>{item.trailing}</> : undefined}
          disabled={item.disabled}
          titleStyle={[styles.title, item.destructive && styles.destructive]}
        />
      ))}
    </Menu>
  );
}

const styles = StyleSheet.create({
  content: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  title: { ...Typography.body, fontSize: 14 },
  destructive: { color: Colors.danger },
});
