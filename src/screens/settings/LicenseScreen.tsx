import React, { useState } from "react";
import { View, Text, TextInput, Pressable } from "react-native";
import { usePremium } from "../../premium/PremiumContext";

export default function LicenseScreen() {
  const { isPremium, activate } = usePremium();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  return (
    <View style={{ flex: 1, padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 18, fontWeight: "700" }}>Activate License</Text>

      <Text style={{ opacity: 0.8 }}>
        Example accepted code for now: PREMIUM-1234
      </Text>

      <TextInput
        value={code}
        onChangeText={setCode}
        autoCapitalize="characters"
        placeholder="Enter license code"
        style={{
          borderWidth: 1,
          borderRadius: 12,
          padding: 12,
          fontSize: 16,
        }}
      />

      <Pressable
        onPress={async () => {
          const res = await activate(code);
          setMessage(res.message);
        }}
        style={{ padding: 14, borderWidth: 1, borderRadius: 12 }}
      >
        <Text>{isPremium ? "Premium Active" : "Activate"}</Text>
      </Pressable>

      {message && <Text style={{ marginTop: 8 }}>{message}</Text>}
    </View>
  );
}
