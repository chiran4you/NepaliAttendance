// src/components/Screen.tsx
import React from "react";
import { View, StyleSheet, ViewStyle } from "react-native";
import { Colors } from "../constants/colors";

type Props = {
  children: React.ReactNode;
  style?: ViewStyle;
};

/**
 * Simple screen wrapper for consistent background + layout.
 * (No new deps; works everywhere in Expo Router.)
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
