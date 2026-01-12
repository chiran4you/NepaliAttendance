import React from "react";
import { View, Text, Pressable, Alert } from "react-native";
import { usePremium } from "../../premium/PremiumContext";
import { useNavigation } from "@react-navigation/native";

export default function ReportsScreen() {
  const { isPremium } = usePremium();
  const navigation = useNavigation<any>();

  const onExportCsv = () => {
    if (!isPremium) {
      Alert.alert("Premium feature", "Export CSV requires Premium.", [
        { text: "Cancel", style: "cancel" },
        { text: "Unlock", onPress: () => navigation.navigate("SettingsTab", { screen: "License" }) },
      ]);
      return;
    }
    Alert.alert("Export", "Exporting CSV... (connect your actual export code here)");
  };

  return (
    <View style={{ flex: 1, padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: "700" }}>Reports</Text>

      <Pressable
        onPress={onExportCsv}
        style={{ padding: 14, borderWidth: 1, borderRadius: 12 }}
      >
        <Text>Export CSV (Premium)</Text>
      </Pressable>
    </View>
  );
}
