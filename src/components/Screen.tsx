// src/components/Screen.tsx
import React from "react";
import { View, StyleSheet, ViewStyle } from "react-native";
import { Colors } from "../constants/colors";

type Props = {
  children: React.ReactNode;
  style?: ViewStyle;
};

/**
 * Screen wrapper.
 *
 * IMPORTANT:
 * With Expo Router <Tabs />, the tab bar already occupies layout space (it is not overlaying the screen).
 * So adding a fixed paddingBottom creates a visible blank gap above the tabs.
 *
 * If you ever have a screen where content is truly hidden behind the tab bar, add bottom padding
 * in THAT screen only (not globally here).
 */
export default function Screen({ children, style }: Props) {
  return <View style={[styles.container, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
});
