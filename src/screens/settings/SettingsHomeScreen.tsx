import React from "react";
import { View, Text, Pressable } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { SettingsStackParamList } from "../../navigation/stacks/SettingsStack";
import { usePremium } from "../../premium/PremiumContext";

type Props = NativeStackScreenProps<SettingsStackParamList, "SettingsHome">;

export default function SettingsHomeScreen({ navigation }: Props) {
  const { isPremium, licenseCode, deactivate } = usePremium();

  return (
    <View style={{ flex: 1, padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: "700" }}>Settings</Text>

      <View style={{ padding: 14, borderWidth: 1, borderRadius: 12 }}>
        <Text style={{ fontWeight: "600" }}>Premium</Text>
        <Text style={{ marginTop: 6 }}>
          Status: {isPremium ? "Active ✅" : "Not active"}
        </Text>
        {isPremium && <Text style={{ marginTop: 4, opacity: 0.7 }}>Code: {licenseCode}</Text>}
      </View>

      <Pressable
        onPress={() => navigation.navigate("License")}
        style={{ padding: 14, borderWidth: 1, borderRadius: 12 }}
      >
        <Text>License / Unlock Premium</Text>
      </Pressable>

      {isPremium && (
        <Pressable
          onPress={deactivate}
          style={{ padding: 14, borderWidth: 1, borderRadius: 12 }}
        >
          <Text>Deactivate Premium</Text>
        </Pressable>
      )}
    </View>
  );
}
