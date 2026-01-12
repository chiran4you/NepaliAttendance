// src/components/AppHeader.tsx
import React from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Colors } from "../constants/colors";

type Props = {
  name?: string;
  address?: string;
};

/**
 * Gradient header (high impact, still professional):
 * - Visibly stands out
 * - Keeps school name max 2 lines
 * - Works across all tabs
 *
 * Note: Ensure you have expo-linear-gradient installed.
 * In Expo SDKs it's typically available; if not:
 *   npx expo install expo-linear-gradient
 */
export default function AppHeader({ name, address }: Props) {
  return (
    <View style={styles.wrap}>
      <LinearGradient
        colors={["#2563EB", "#6D83FF", "#EEF2FF"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <View style={styles.content}>
          <Text style={styles.title} numberOfLines={2} ellipsizeMode="tail">
            {name || "NepaliAttendance"}
          </Text>

          {!!address && (
            <Text style={styles.address} numberOfLines={1} ellipsizeMode="tail">
              {address}
            </Text>
          )}
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: 1,
    borderBottomColor: "#C7D2FE",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.18,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 10 },
      },
      android: { elevation: 8 },
      default: {},
    }),
  },
  gradient: {
    paddingTop: 10,
    paddingBottom: 14,
    paddingHorizontal: 16,
  },
  content: {
    // subtle frosted surface for text readability
    backgroundColor: "rgba(255,255,255,0.78)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.65)",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: "900",
    color: Colors.textPrimary,
    lineHeight: 23,
    letterSpacing: 0.3,
  },
  address: {
    marginTop: 4,
    fontSize: 13,
    color: Colors.textSecondary,
  },
});
