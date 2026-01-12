// app/setup.tsx
import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  Alert,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from "react-native";
import { Redirect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import Screen from "../src/components/Screen";
import { Colors } from "../src/constants/colors";
import { APP_CONFIG } from "../src/constants/appConfig";
import { useTenant } from "../src/tenant/TenantContext";

export default function SetupScreen() {
  const { loading, tenant, setTenant } = useTenant();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  if (!loading && tenant) {
    return <Redirect href="/(tabs)/classes" />;
  }

  const activate = useCallback(async () => {
    const tenantCode = code.trim();
    if (!tenantCode) {
      Alert.alert("Enter school code", "Please enter the activation code provided by your school.");
      return;
    }

    const rtdbBase = APP_CONFIG.RTDB_URL?.replace(/\/+$/, "");
    if (!rtdbBase) {
      Alert.alert("Config error", "RTDB_URL is missing. Check src/constants/appConfig.ts");
      return;
    }

    setBusy(true);
    try {
      const codeUrl = `${rtdbBase}/tenant_codes/${encodeURIComponent(tenantCode)}.json`;
      const res = await fetch(codeUrl);

      const text = await res.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {}

      if (!res.ok) {
        Alert.alert(
          "Activation failed",
          `Server replied ${res.status}.\n\nURL:\n${codeUrl}\n\nBody:\n${text || "(empty)"}`
        );
        return;
      }

      if (!data) {
        Alert.alert(
          "Invalid code",
          `Code not found in RTDB.\n\nURL checked:\n${codeUrl}\n\nTip: open the same URL in browser to verify.`
        );
        return;
      }

      if (!data.active) {
        Alert.alert("Invalid code", "This code is inactive or not found.");
        return;
      }

      const tenantId = data.tenantId;
      if (!tenantId) {
        Alert.alert("Activation failed", "Tenant ID missing in code record.");
        return;
      }

      const cfgUrl = `${rtdbBase}/tenants/${encodeURIComponent(tenantId)}.json`;
      const cfgRes = await fetch(cfgUrl);
      const cfgText = await cfgRes.text();
      let cfg: any = null;
      try {
        cfg = cfgText ? JSON.parse(cfgText) : null;
      } catch {}

      if (!cfgRes.ok) {
        Alert.alert(
          "Activation failed",
          `Unable to load school info (${cfgRes.status}).\n\nURL:\n${cfgUrl}\n\nBody:\n${cfgText || "(empty)"}`
        );
        return;
      }

      const schoolName = String(cfg?.schoolName ?? cfg?.name ?? "School");
      const schoolAddress = String(cfg?.schoolAddress ?? cfg?.address ?? "");

      await setTenant({ tenantId, schoolName, schoolAddress });

      Alert.alert("Activated", "School activated successfully.");
    } catch (e: any) {
      Alert.alert("Activation failed", e?.message ?? "Please try again.");
    } finally {
      setBusy(false);
    }
  }, [code, loading, setTenant]);

  return (
    <Screen>
      <View style={styles.container}>
        <View style={styles.hero}>
          <View style={styles.logo}>
            <Ionicons name="school" size={22} color="#fff" />
          </View>
          <Text style={styles.title}>NepaliAttendance</Text>
          <Text style={styles.subtitle}>Enter your school code to activate this device.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>School Code</Text>
          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder="e.g. NA-XXXX-XXXX-XXXX"
            placeholderTextColor={Colors.muted}
            autoCapitalize="characters"
            style={styles.input}
          />

          <Pressable
            onPress={activate}
            disabled={busy || loading}
            style={({ pressed }) => [
              styles.btn,
              (busy || loading) && { opacity: 0.6 },
              pressed && { opacity: 0.9 },
            ]}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Activate</Text>}
          </Pressable>

          <Text style={styles.hint}>
            Activation needs internet once. After activation, the app works offline.
          </Text>
        </View>

        {loading ? <Text style={styles.loading}>Loading…</Text> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingTop: 32, gap: 14 },
  hero: { alignItems: "center", gap: 8, marginBottom: 2 },
  logo: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      android: { elevation: 3 },
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.12,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 6 },
      },
      default: {},
    }),
  },
  title: { fontSize: 18, fontWeight: "900", color: Colors.textPrimary },
  subtitle: {
    textAlign: "center",
    color: Colors.textSecondary,
    fontWeight: "800",
    lineHeight: 18,
    maxWidth: 320,
  },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10,
    ...Platform.select({
      android: { elevation: 2 },
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.06,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 8 },
      },
      default: {},
    }),
  },

  label: { fontSize: 12, fontWeight: "900", color: Colors.textSecondary },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: Colors.textPrimary,
    backgroundColor: "#fff",
  },
  btn: {
    marginTop: 2,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontWeight: "900" },
  hint: { color: Colors.textSecondary, fontSize: 12, lineHeight: 16, marginTop: 4, fontWeight: "800" },
  loading: { color: Colors.textSecondary, textAlign: "center", fontWeight: "800" },
});
