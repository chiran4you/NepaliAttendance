// src/components/Screen.tsx
import React from "react";
import { View, StyleSheet, ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors } from "../constants/colors";

type Props = {
  children: React.ReactNode;
  style?: ViewStyle;
};

/**
 * Simple screen wrapper for consistent background + layout.
 * Adds bottom padding so content doesn't hide under the tab bar.
 */
export default function Screen({ children, style }: Props) {
  const insets = useSafeAreaInsets();
  const TAB_BAR_HEIGHT = 64;

  return (
    <View
      style={[
        styles.container,
        { paddingBottom: TAB_BAR_HEIGHT + insets.bottom },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
});
