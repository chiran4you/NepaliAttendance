// app/(tabs)/settings.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Alert,
  StyleSheet,
  Platform,
  TextInput,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as SQLite from "expo-sqlite";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";

import Screen from "../../src/components/Screen";
import AppHeader from "../../src/components/AppHeader";
import { Colors } from "../../src/constants/colors";
import { APP_CONFIG } from "../../src/constants/appConfig";
import { useTenant } from "../../src/tenant/TenantContext";
import { usePremium } from "../../src/premium/usePremium";

const DB_NAME = "nepaliattendance.db";

export default function SettingsScreen() {
  const { tenant, logoutTenant } = useTenant();

  const tenantId = tenant.tenantId;

  const SMS_SCHOOL_NAME_KEY = `smsSchoolName:${tenantId}`;
  const [smsSchoolName, setSmsSchoolName] = useState("");
  const [savingSmsSchoolName, setSavingSmsSchoolName] = useState(false);
  const [savedSmsSchoolName, setSavedSmsSchoolName] = useState("");

  useEffect(() => {
    AsyncStorage.getItem(SMS_SCHOOL_NAME_KEY)
      .then((savedName) => {
        const value = (savedName ?? "").trim();
        setSmsSchoolName(value);
        setSavedSmsSchoolName(value);
      })
      .catch(() => {});
  }, [SMS_SCHOOL_NAME_KEY]);

  const saveSmsSchoolName = async () => {
    const shortName = smsSchoolName.trim();
    if (!shortName) {
      Alert.alert("Enter SMS school name", "Example: Chhatrapali TSS");
      return;
    }

    setSavingSmsSchoolName(true);
    try {
      await AsyncStorage.setItem(SMS_SCHOOL_NAME_KEY, shortName);
      setSmsSchoolName(shortName);
      setSavedSmsSchoolName(shortName);
      Alert.alert("Saved", "SMS school name has been saved.");
    } catch (e: any) {
      Alert.alert("Save failed", e?.message ?? "Could not save the SMS school name.");
    } finally {
      setSavingSmsSchoolName(false);
    }
  };

  const { loading, premiumEnabled, statusText, deviceId, entitlement, activate, clear } =
    usePremium(tenantId);

  const [licenseKey, setLicenseKey] = useState("");
  const [activating, setActivating] = useState(false);

  const expired = entitlement?.expiresAt != null && Date.now() > entitlement.expiresAt;
  const isLicenseActive = premiumEnabled && !expired;
  // Disable "Activate Online" once activated; enable again if expired offline
  const canActivate = !loading && !activating && !isLicenseActive;

  // Reset modal state
  const [resetOpen, setResetOpen] = useState(false);
  const [resetText, setResetText] = useState("");
  const [resetting, setResetting] = useState(false);

  const lastVerified = useMemo(() => {
    if (!entitlement?.lastVerifiedAt) return "-";
    return new Date(entitlement.lastVerifiedAt).toLocaleString();
  }, [entitlement]);

  const expiryText = useMemo(() => {
    if (!entitlement) return "-";
    if (entitlement.expiresAt == null) return "No expiry";
    return new Date(entitlement.expiresAt).toLocaleDateString();
  }, [entitlement]);

  const appVersion =
    // Prefer expo config version (works in dev + build)
    (Constants.expoConfig as any)?.version ??
    // Fallbacks
    (Constants as any).nativeAppVersion ??
    "-";

  const runtimeVersion =
    (Constants.expoConfig as any)?.runtimeVersion ??
    (Constants as any).runtimeVersion ??
    "-";

  const onActivate = async () => {
    if (!tenantId) return;

    if (!licenseKey.trim()) {
      Alert.alert("Enter license key", "Please paste the license key you received.");
      return;
    }

    if (APP_CONFIG.API_BASE_URL.includes("YOUR-SERVER-URL")) {
      Alert.alert(
        "Set your server URL",
        "Open src/constants/appConfig.ts and set API_BASE_URL to your hosted backend URL."
      );
      return;
    }

    setActivating(true);
    try {
      await activate(licenseKey.trim());
      Alert.alert("Activated", "Premium status verified and saved on this device.");
      setLicenseKey("");
    } catch (e: any) {
      Alert.alert("Activation failed", e?.message ?? "Please try again.");
    } finally {
      setActivating(false);
    }
  };

  const openReset = () => {
    setResetText("");
    setResetOpen(true);
  };

  const resetEverything = async () => {
    if (!tenantId) return;

    const typed = resetText.trim().toUpperCase();
    if (typed !== "RESET") {
      Alert.alert("Type RESET", 'Please type "RESET" to confirm.');
      return;
    }

    setResetting(true);
    try {
      // 1) clear premium cache (AsyncStorage) via existing hook
      await clear();
      await AsyncStorage.removeItem(SMS_SCHOOL_NAME_KEY);

      // 2) delete local SQLite database (classes, students, attendance)
      try {
        const anySQLite: any = SQLite as any;
        if (typeof anySQLite.deleteDatabaseAsync === "function") {
          await anySQLite.deleteDatabaseAsync(DB_NAME);
        } else {
          // Older expo-sqlite versions may not support deleteDatabaseAsync.
          // In that case, the reset will still remove school activation.
          console.warn("SQLite.deleteDatabaseAsync not available in this SDK.");
        }
      } catch (e) {
        console.warn("DB delete failed:", e);
      }

      // 3) remove tenant activation + go back to setup
      await logoutTenant();

      Alert.alert("Reset complete", "School setup and local data were removed from this device.");
      setResetOpen(false);
    } catch (e: any) {
      Alert.alert("Reset failed", e?.message ?? "Please try again.");
    } finally {
      setResetting(false);
    }
  };

  const smsNameChanged = smsSchoolName.trim() !== savedSmsSchoolName.trim();
  const canSaveSmsName = !!smsSchoolName.trim() && smsNameChanged && !savingSmsSchoolName;

  if (!tenant) return null;

  return (
    <Screen>
      <AppHeader name={tenant.schoolName} address={tenant.schoolAddress} />

      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        {/* Premium card */}
        <View style={styles.card}>
          <View style={styles.cardTopRow}>
            <Text style={styles.cardTitle}>Premium</Text>
            <View style={[styles.badge, isLicenseActive ? styles.badgeOn : styles.badgeOff]}>
              <Text
                style={[
                  styles.badgeText,
                  isLicenseActive ? styles.badgeTextOn : styles.badgeTextOff,
                ]}
              >
                {isLicenseActive ? "ACTIVE" : "LOCKED"}
              </Text>
            </View>
          </View>

          <Text style={styles.subtle}>
            Status: <Text style={styles.strong}>{statusText}</Text>
          </Text>
          <Text style={styles.subtleSmall}>Device ID: {deviceId || "-"}</Text>
          <Text style={styles.subtleSmall}>Last verified: {lastVerified}</Text>
          <Text style={styles.subtleSmall}>Expiry: {expiryText}</Text>

          <View style={{ height: 12 }} />

          <Text style={styles.label}>License Key</Text>
          <TextInput
            value={licenseKey}
            onChangeText={setLicenseKey}
            placeholder="Paste license key"
            placeholderTextColor={Colors.muted}
            autoCapitalize="characters"
            style={[styles.input, !smsNameChanged && !!savedSmsSchoolName && { backgroundColor: "#F8FAFC", color: Colors.textSecondary }]}
          />

          <View style={styles.row}>
            <Pressable
              onPress={onActivate}
              disabled={!canActivate || !licenseKey.trim()}
              style={({ pressed }) => [
                styles.primaryBtn,
                (!canActivate || !licenseKey.trim()) && { opacity: 0.55 },
                pressed && { opacity: 0.9 },
              ]}
            >
              <Text style={styles.primaryBtnText}>
                {isLicenseActive ? "Activated" : activating ? "Activating..." : "Activate Online"}
              </Text>
            </Pressable>
          </View><View style={styles.featureBox}>
            <Text style={styles.featureTitle}>Premium features</Text>

            <View style={styles.featureRow}>
              <Ionicons name="download-outline" size={18} color={Colors.primary} />
              <Text style={styles.featureText}>Export CSV (Reports)</Text>
            </View>

            <View style={styles.featureRow}>
              <Ionicons name="chatbubble-ellipses-outline" size={18} color={Colors.primary} />
              <Text style={styles.featureText}>
                SMS Alerts (Attendance) • per-class toggle • queued offline
              </Text>
            </View>

            <View style={styles.featureRow}>
              <Ionicons name="cloud-upload-outline" size={18} color={Colors.primary} />
              <Text style={styles.featureText}>
                Import Students (Excel/CSV) • preview • validation
              </Text>
            </View>

            <Text style={styles.hint}>
              Premium activation requires internet. After activation, premium features remain available
              until the actual license expiry date.
            </Text>
          </View>
        </View>

        {/* SMS settings */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>SMS Settings</Text>

          <Text style={styles.label}>SMS School Name</Text>
          <TextInput
            value={smsSchoolName}
            onChangeText={setSmsSchoolName}
            placeholder="Example: Chhatrapali TSS"
            placeholderTextColor={Colors.muted}
            autoCapitalize="words"
            maxLength={25}
            style={styles.input}
          />

          <Pressable
            onPress={saveSmsSchoolName}
            disabled={!canSaveSmsName}
            style={({ pressed }) => [
              styles.primaryBtn,
              !canSaveSmsName && { opacity: 0.45 },
              pressed && canSaveSmsName && { opacity: 0.9 },
            ]}
          >
            <Text style={styles.primaryBtnText}>
              {savingSmsSchoolName ? "Saving..." : smsNameChanged ? "Save SMS Name" : "Saved"}
            </Text>
          </Pressable>

          <Text style={styles.hint}>
            Used only in attendance SMS messages. Example: Chhatrapali TSS
          </Text>
        </View>

        {/* Device & data management */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Device & Data</Text>

          <Pressable
            onPress={openReset}
            style={({ pressed }) => [styles.dangerBtn, pressed && { opacity: 0.9 }]}
          >
            <Text style={styles.dangerBtnText}>Reset School & Delete Local Data</Text>
          </Pressable>

          <Text style={styles.hint}>
            Reset will remove: classes, students, attendance, premium cache, and school activation
            from this device.
          </Text>
        </View>

        {/* About */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>About</Text>

          <View style={styles.aboutRow}>
            <View style={styles.aboutIcon}>
              <Ionicons name="school" size={18} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.aboutAppName}>NepaliAttendance</Text>
              <Text style={styles.aboutSub}>Offline-first attendance for Nepali schools</Text>
            </View>
          </View>

          <View style={styles.aboutGrid}>
            <View style={styles.aboutBox}>
              <Text style={styles.aboutLabel}>Version</Text>
              <Text style={styles.aboutValue}>{String(appVersion)}</Text>
            </View>
            <View style={styles.aboutBox}>
              <Text style={styles.aboutLabel}>Runtime</Text>
              <Text style={styles.aboutValue}>{String(runtimeVersion)}</Text>
            </View>
          </View>

          <View style={styles.aboutLine} />

          <Text style={styles.aboutSectionTitle}>Developer</Text>
          <Text style={styles.aboutText}>
            Built by Chiran Poudel(NepaliAttendance Team)
          </Text>
          <Text style={styles.aboutText}>
            Support: iamchiran4you@gmail.com
          </Text>
          <Text style={styles.aboutText}>
            WhatsApp/Call:9811990099/9705449944
          </Text>
        </View>
      </ScrollView>

      {/* Reset confirmation modal */}
      <Modal visible={resetOpen} transparent animationType="fade" onRequestClose={() => setResetOpen(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setResetOpen(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Reset School</Text>
              <Pressable onPress={() => setResetOpen(false)} style={styles.modalClose}>
                <Ionicons name="close" size={18} color={Colors.textPrimary} />
              </Pressable>
            </View>

            <Text style={styles.modalWarn}>
              This will delete ALL local data on this device:
              {"\n"}• Classes
              {"\n"}• Students
              {"\n"}• Attendance
              {"\n"}• Premium cache
              {"\n"}• School activation
            </Text>

            <Text style={[styles.label, { marginTop: 10 }]}>Type RESET to confirm</Text>
            <TextInput
              value={resetText}
              onChangeText={setResetText}
              autoCapitalize="characters"
              placeholder="RESET"
              placeholderTextColor={Colors.muted}
              style={styles.input}
            />

            <View style={[styles.row, { marginTop: 10 }]}>
              <Pressable
                onPress={() => setResetOpen(false)}
                style={({ pressed }) => [styles.secondaryBtn, { flex: 1 }, pressed && { opacity: 0.9 }]}
                disabled={resetting}
              >
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </Pressable>

              <Pressable
                onPress={resetEverything}
                style={({ pressed }) => [
                  styles.dangerBtn,
                  { flex: 1, marginTop: 0 },
                  (resetting || resetText.trim().length === 0) && { opacity: 0.7 },
                  pressed && { opacity: 0.9 },
                ]}
                disabled={resetting}
              >
                <Text style={styles.dangerBtnText}>
                  {resetting ? "Resetting..." : "Reset"}
                </Text>
              </Pressable>
            </View>

            <Text style={styles.modalHint}>
              Tip: After reset, you will need to enter the tenant code again.
            </Text>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 28, gap: 12 },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.06,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 8 },
      },
      android: { elevation: 2 },
      default: {},
    }),
  },

  cardTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardTitle: { fontSize: 14, fontWeight: "900", color: Colors.textPrimary },

  badge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeOn: { backgroundColor: "#ECFDF3", borderColor: "#ABEFC6" },
  badgeOff: { backgroundColor: "#FEF2F2", borderColor: "#FECACA" },
  badgeText: { fontWeight: "900", fontSize: 11 },
  badgeTextOn: { color: "#067647" },
  badgeTextOff: { color: "#B42318" },

  subtle: { color: Colors.textSecondary, lineHeight: 18 },
  subtleSmall: { color: Colors.textSecondary, fontSize: 12 },
  strong: { color: Colors.primary, fontWeight: "900" },

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

  row: { flexDirection: "row", gap: 10, marginTop: 2, alignItems: "center" },
  primaryBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    alignItems: "center",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.15,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 6 },
      },
      android: { elevation: 3 },
      default: {},
    }),
  },
  primaryBtnText: { color: "#fff", fontWeight: "900" },
  secondaryBtn: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: { fontWeight: "900", color: Colors.textPrimary },

  featureBox: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    padding: 12,
    gap: 8,
  },
  featureTitle: { fontWeight: "900", color: Colors.textPrimary, fontSize: 13 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  featureText: { fontWeight: "800", color: Colors.textPrimary, flex: 1, lineHeight: 18 },
  hint: { color: Colors.textSecondary, fontSize: 12, lineHeight: 16, marginTop: 4 },

  dangerBtn: {
    marginTop: 8,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#FECACA",
    backgroundColor: "#FEF2F2",
    alignItems: "center",
    justifyContent: "center",
  },
  dangerBtnText: { fontWeight: "900", color: "#B42318" },

  // About
  aboutRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 2 },
  aboutIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  aboutAppName: { fontSize: 14, fontWeight: "900", color: Colors.textPrimary },
  aboutSub: { marginTop: 2, fontSize: 12, color: Colors.textSecondary, fontWeight: "800" },

  aboutGrid: { flexDirection: "row", gap: 10, marginTop: 8 },
  aboutBox: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: "#F8FAFC",
    paddingVertical: 10,
    alignItems: "center",
  },
  aboutLabel: { fontSize: 11, fontWeight: "800", color: Colors.textSecondary },
  aboutValue: { marginTop: 2, fontSize: 13, fontWeight: "900", color: Colors.textPrimary },

  aboutLine: { height: 1, backgroundColor: Colors.border, marginVertical: 6 },
  aboutSectionTitle: { fontSize: 12, fontWeight: "900", color: Colors.textPrimary },
  aboutText: { color: Colors.textSecondary, fontSize: 12, fontWeight: "800", marginTop: 2 },

  // Reset modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    padding: 16,
    justifyContent: "center",
  },
  modalCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: "#FFFFFF",
    padding: 12,
  },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalTitle: { fontWeight: "900", color: Colors.textPrimary, fontSize: 14 },
  modalClose: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8FAFC",
  },
  modalWarn: { marginTop: 10, color: Colors.textPrimary, fontWeight: "800", lineHeight: 18 },
  modalHint: { marginTop: 10, color: Colors.textSecondary, fontSize: 12, fontWeight: "800" },
});
