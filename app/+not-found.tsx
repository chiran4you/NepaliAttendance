import React from "react";
import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";

export default function NotFound() {
  const router = useRouter();

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 20 }}>
      <Text style={{ fontSize: 18, fontWeight: "900" }}>Page not found</Text>
      <Text style={{ marginTop: 8, color: "#64748B", textAlign: "center" }}>
        The route you opened doesn’t exist. Please go back to Home.
      </Text>

      <Pressable
        onPress={() => router.replace("/setup")}
        style={{
          marginTop: 14,
          paddingVertical: 12,
          paddingHorizontal: 16,
          borderRadius: 12,
          backgroundColor: "#111827",
        }}
      >
        <Text style={{ color: "#fff", fontWeight: "900" }}>Go to Setup</Text>
      </Pressable>
    </View>
  );
}
