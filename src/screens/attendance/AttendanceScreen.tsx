import React, { useState } from "react";
import { View, Text, Pressable, Switch, Alert } from "react-native";
import { usePremium } from "../../premium/PremiumContext";
import { useNavigation } from "@react-navigation/native";

export default function AttendanceScreen() {
  const { isPremium } = usePremium();
  const navigation = useNavigation<any>();
  const [smsEnabled, setSmsEnabled] = useState(false);

  const onToggleSms = (next: boolean) => {
    if (!isPremium) {
      Alert.alert("Premium feature", "SMS Alerts require Premium.", [
        { text: "Cancel", style: "cancel" },
        { text: "Unlock", onPress: () => navigation.navigate("SettingsTab", { screen: "License" }) },
      ]);
      return;
    }
    setSmsEnabled(next);
  };

  return (
    <View style={{ flex: 1, padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: "700" }}>Attendance</Text>

      <View style={{ padding: 14, borderWidth: 1, borderRadius: 12 }}>
        <Text style={{ fontWeight: "600" }}>SMS Alerts (Premium)</Text>
        <Text style={{ marginTop: 6, opacity: 0.8 }}>
          Send alerts when a student is absent/late.
        </Text>

        <View style={{ marginTop: 10, flexDirection: "row", justifyContent: "space-between" }}>
          <Text>Enable</Text>
          <Switch value={smsEnabled} onValueChange={onToggleSms} />
        </View>

        {!isPremium && (
          <Pressable
            onPress={() => navigation.navigate("SettingsTab", { screen: "License" })}
            style={{ marginTop: 12, padding: 12, borderWidth: 1, borderRadius: 12 }}
          >
            <Text>Unlock Premium</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
