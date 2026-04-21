import { ReactNode } from "react";
import { Text } from "react-native";

export default function Debug({ children }: { children: ReactNode }) {
  return (
    <Text
      style={{
        fontFamily: "monospace",
        backgroundColor: "white",
      }}
    >
      {children}
    </Text>
  );
}
