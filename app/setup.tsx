import React, { useState } from "react";
import { View, Text, TextInput, Pressable, Alert, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { useTenant } from "../src/tenant/TenantContext";

export default function SetupScreen() {
  // Updated to match TenantContext API (Realtime DB version)
  const { activateWithSchoolCode } = useTenant();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  const onContinue = async () => {
    const trimmed = code.trim();
    if (!trimmed) return Alert.alert("School Code required", "Please enter your school code.");

    try {
      setLoading(true);
      await activateWithSchoolCode(trimmed);
      router.replace("/(tabs)/classes");
    } catch (e: any) {
      Alert.alert("Setup failed", e?.message ?? "Could not activate school.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, padding: 16, justifyContent: "center", gap: 12 }}>
      <Text style={{ fontSize: 24, fontWeight: "800" }}>NepaliAttendance</Text>
      <Text style={{ opacity: 0.75 }}>Enter your School Code to activate this device.</Text>

      <TextInput
        value={code}
        onChangeText={setCode}
        placeholder="e.g. NPL-7K3Q-9Z2M"
        autoCapitalize="characters"
        style={{ borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 16 }}
      />

      <Pressable
        onPress={onContinue}
        disabled={loading}
        style={{ borderWidth: 1, borderRadius: 12, padding: 14, alignItems: "center" }}
      >
        {loading ? <ActivityIndicator /> : <Text style={{ fontWeight: "700" }}>Continue</Text>}
      </Pressable>
    </View>
  );
}
