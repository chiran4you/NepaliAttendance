// app/(tabs)/reports.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  FlatList,
  Alert,
  StyleSheet,
  Platform,
  Modal,
} from "react-native";
import NepaliDate from "nepali-date-converter";
import { Ionicons } from "@expo/vector-icons";
import { CalendarPicker } from "react-native-nepali-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";

import Screen from "../../src/components/Screen";
import AppHeader from "../../src/components/AppHeader";
import { Colors } from "../../src/constants/colors";
import { useTenant } from "../../src/tenant/TenantContext";
import { listClasses, type ClassItem } from "../../src/db/classRepo";
import {
  getMonthlyAttendanceSummary,
  type MonthlyStudentSummary,
} from "../../src/db/reportRepo";

function todayBs(): string {
  return new NepaliDate().format("YYYY-MM-DD");
}

// dateBs: "YYYY-MM-DD" => monthBs: "YYYY-MM"
function monthFromBsDate(dateBs: string): string {
  return String(dateBs).slice(0, 7);
}

// ✅ IMPORTANT: keep regex on one line (Metro bundler)
function csvEscape(value: unknown): string {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function readPremiumEntitlement(): Promise<{
  premium: boolean;
  expiresAt: number | null;
} | null> {
  const keys = [
    "premiumEntitlement",
    "premium_entitlement",
    "entitlement",
    "license_entitlement",
  ];

  for (const k of keys) {
    const raw = await AsyncStorage.getItem(k);
    if (!raw) continue;

    try {
      const obj = JSON.parse(raw);
      const premium = Boolean(obj?.premium);
      const expiresAt =
        obj?.expiresAt === null || obj?.expiresAt === undefined
          ? null
          : Number(obj?.expiresAt);

      return {
        premium,
        expiresAt: Number.isFinite(expiresAt) ? expiresAt : null,
      };
    } catch {
      // ignore
    }
  }

  return null;
}

export default function ReportsScreen() {
  const { tenant } = useTenant();
  const router = useRouter();

  const tenantId = tenant?.tenantId ?? null;
  const csvAllowedForSchool = !!tenant?.features?.csvExportEnabled;

  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [classId, setClassId] = useState<string | null>(null);

  const [monthBs, setMonthBs] = useState<string>(monthFromBsDate(todayBs()));
  const [pickerOpen, setPickerOpen] = useState(false);

  const [rows, setRows] = useState<MonthlyStudentSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const [premiumOk, setPremiumOk] = useState(false);

  // ✅ when we come back to Reports, force a reload
  const [refreshTick, setRefreshTick] = useState(0);

  // Premium status from cached entitlement (offline)
  useEffect(() => {
    let mounted = true;

    (async () => {
      const ent = await readPremiumEntitlement();
      const now = Date.now();
      const ok =
        Boolean(ent?.premium) &&
        (ent?.expiresAt == null || (Number(ent.expiresAt) > 0 && now <= ent.expiresAt));

      if (mounted) setPremiumOk(ok);
    })();

    return () => {
      mounted = false;
    };
  }, [tenantId, refreshTick]);

  const refreshClasses = useCallback(async () => {
    if (!tenantId) return;

    try {
      // ✅ FIX: listClasses expects (tenantId: string)
      const list = await listClasses(tenantId);
      setClasses(list);

      // keep selection stable
      if (!classId) setClassId(list[0]?.id ?? null);
      if (classId && !list.some((c) => c.id === classId)) setClassId(list[0]?.id ?? null);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to load classes");
    }
  }, [tenantId, classId]);

  // ✅ FIX: refresh classes + report every time Reports tab is focused
  useFocusEffect(
    useCallback(() => {
      refreshClasses();
      setRefreshTick((t) => t + 1);
    }, [refreshClasses])
  );

  // initial load
  useEffect(() => {
    refreshClasses();
  }, [refreshClasses]);

  // load report whenever class/month changes OR when we come back to tab
  useEffect(() => {
    if (!tenantId || !classId) {
      setRows([]);
      return;
    }

    let mounted = true;

    (async () => {
      setLoading(true);
      try {
        const data = await getMonthlyAttendanceSummary({
          tenantId,
          classId,
          monthBs,
        });
        if (mounted) setRows(data);
      } catch (e: any) {
        Alert.alert("Error", e?.message ?? "Failed to load report");
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [tenantId, classId, monthBs, refreshTick]);

  const selectedClass = useMemo(
    () => classes.find((c) => c.id === classId) ?? null,
    [classes, classId]
  );

  const totals = useMemo(() => {
    const totalDays = rows.length > 0 ? Math.max(...rows.map((r) => r.total)) : 0;
    const avg = rows.length
      ? Math.round(rows.reduce((sum, r) => sum + r.percentage, 0) / rows.length)
      : 0;
    return { totalDays, avg };
  }, [rows]);

  const { sumPresent, sumAbsent, sumTotal, overallRate } = useMemo(() => {
    const sp = rows.reduce((sum, r) => sum + (r.present || 0), 0);
    const sa = rows.reduce((sum, r) => sum + (r.absent || 0), 0);
    const st = rows.reduce((sum, r) => sum + (r.total || 0), 0);

    const rate = st > 0 ? Math.round((sp / st) * 100) : 0;
    return { sumPresent: sp, sumAbsent: sa, sumTotal: st, overallRate: rate };
  }, [rows]);

  const onPickDate = (picked: string) => {
    setMonthBs(monthFromBsDate(picked));
    setPickerOpen(false);
  };

  async function exportCsv() {
    if (!tenantId || !selectedClass) return;

    if (!csvAllowedForSchool) {
      Alert.alert("Export not available", "CSV export is disabled for this school.");
      return;
    }

    if (!premiumOk) {
      Alert.alert(
        "Premium required",
        "CSV export is a premium feature. Activate Premium in Settings.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Go to Settings", onPress: () => router.push("/(tabs)/settings") },
        ]
      );
      return;
    }

    if (rows.length === 0) {
      Alert.alert("Nothing to export", "No data found for this month.");
      return;
    }

    try {
      const header = [
        "BS Month",
        "Class",
        "Section",
        "Roll No",
        "Student Name",
        "Present",
        "Absent",
        "Total",
        "Percentage",
      ];

      const className = selectedClass.name ?? "";
      const section = (selectedClass as any).section ?? "";

      const csv = [
        header.map(csvEscape).join(","),
        ...rows.map((r) =>
          [
            monthBs,
            className,
            section,
            r.rollNo,
            r.name,
            r.present,
            r.absent,
            r.total,
            `${r.percentage}%`,
          ]
            .map(csvEscape)
            .join(",")
        ),
      ].join("\n");

      

      // ✅ Add UTF-8 BOM so Excel opens Nepali text correctly
      const csvWithBom = "\ufeff" + csv;
const safeClass = String(className).replace(/[^a-z0-9_-]+/gi, "_");
      const safeSection = String(section).replace(/[^a-z0-9_-]+/gi, "_");
      const ym = monthBs; // "YYYY-MM" in BS
      const fileName = `NepaliAttendance_${safeClass}${safeSection ? `_${safeSection}` : ""}_${ym}.csv`;

      // ✅ Android: let user choose a folder (Storage Access Framework)
      if (Platform.OS === "android" && FileSystem.StorageAccessFramework) {
        const perm = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (perm.granted) {
          const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
            perm.directoryUri,
            fileName,
            "text/csv"
          );
          await FileSystem.writeAsStringAsync(fileUri, csvWithBom, {
            encoding: FileSystem.EncodingType.UTF8,
          });
          Alert.alert("Exported", "CSV saved to the folder you selected.");
          return;
        }
        // If user cancels folder selection, we fall back to sharing (creates a real .csv too).
      }

      // ✅ Fallback: write into cache/document directory, then share
      const baseDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
      if (baseDir) {
        const fileUri = baseDir + fileName;
        await FileSystem.writeAsStringAsync(fileUri, csvWithBom, {
          encoding: FileSystem.EncodingType.UTF8,
        });

        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(fileUri, {
            mimeType: "text/csv",
            dialogTitle: "Export Monthly Attendance CSV",
            UTI: "public.comma-separated-values-text",
          });
          return;
        }

        // Sharing not available: at least tell user where it was saved.
        Alert.alert("Saved", `CSV saved to app storage.\n\nPath:\n${fileUri}`);
        return;
      }

      // ❌ If we reached here, something is wrong: no writable directory was available.
      // We avoid sharing as plain text because users need a real CSV file.
      const diag = [
        `Platform: ${Platform.OS}`,
        `StorageAccessFramework: ${!!FileSystem.StorageAccessFramework}`,
        `cacheDirectory: ${String(FileSystem.cacheDirectory)}`,
        `documentDirectory: ${String(FileSystem.documentDirectory)}`,
        `SharingAvailable: ${await Sharing.isAvailableAsync().catch(() => false)}`,
      ].join("\n");

      Alert.alert(
        "Export failed",
        "Could not find a writable folder to create a CSV file.\n\n" +
          "Fix: install expo-file-system + expo-sharing, then rebuild the app (APK/dev build).\n\n" +
          diag
      );
      return;
} catch (e: any) {
      Alert.alert("Export failed", e?.message ?? "Could not export CSV");
    }
  }

  if (!tenant) return null;

  return (
    <Screen>
      <AppHeader name={tenant.schoolName} address={tenant.schoolAddress} />

      {pickerOpen ? (
        <Modal
          visible={pickerOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setPickerOpen(false)}
        >
          <Pressable style={styles.modalOverlay} onPress={() => setPickerOpen(false)}>
            <Pressable style={styles.modalCard} onPress={() => {}}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Select a BS date</Text>
                <Pressable onPress={() => setPickerOpen(false)} style={styles.modalClose}>
                  <Ionicons name="close" size={18} color={Colors.textPrimary} />
                </Pressable>
              </View>

              <CalendarPicker
                visible={true}
                onClose={() => setPickerOpen(false)}
                onDateSelect={onPickDate}
                brandColor={Colors.primary}
                // @ts-ignore
                language="nepali"
              />

              <Text style={styles.modalHint}>
                We group by month using the picked BS date (YYYY-MM).
              </Text>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}

      {/* ✅ Make FlatList own the whole scroll area so swipe works anywhere */}
      <FlatList
        data={rows}
        keyExtractor={(item) => item.studentId}
        refreshing={loading}
        onRefresh={() => setRefreshTick((t) => t + 1)}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
            <View style={styles.headerRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>Monthly Summary</Text>
                <Text style={styles.subtitle}>
                  BS Month: <Text style={{ fontWeight: "900" }}>{monthBs}</Text>
                  {"  "}•{"  "}
                  {premiumOk ? "Premium Active" : "Premium Locked"}
                </Text>
              </View>

              <Pressable
                onPress={exportCsv}
                style={[
                  styles.exportBtn,
                  (premiumOk && csvAllowedForSchool) ? styles.exportBtnActive : styles.exportBtnLocked,
                ]}
              >
                <Ionicons
                  name={(premiumOk && csvAllowedForSchool) ? "download-outline" : "lock-closed-outline"}
                  size={18}
                  color={(premiumOk && csvAllowedForSchool) ? "#FFFFFF" : Colors.textSecondary}
                />
                <Text
                  style={[
                    styles.exportText,
                    premiumOk ? { color: "#FFFFFF" } : { color: Colors.textSecondary },
                  ]}
                >
                  {(premiumOk && csvAllowedForSchool) ? "Export CSV" : "Export Locked"}
                </Text>
              </Pressable>
            </View>

            {!csvAllowedForSchool ? (
              <Text style={styles.exportHint}>CSV export is disabled for this school.</Text>
            ) : null}

            <View style={styles.controls}>
              <Pressable style={styles.pickerBtn} onPress={() => setPickerOpen(true)}>
                <Ionicons name="calendar-outline" size={18} color={Colors.textPrimary} />
                <Text style={styles.pickerText}>{monthBs}</Text>
              </Pressable>

              {classes.length === 0 ? (
                <View style={styles.emptyMini}>
                  <Ionicons name="school-outline" size={18} color={Colors.textSecondary} />
                  <Text style={styles.emptyMiniText}>No classes yet. Add classes first.</Text>
                </View>
              ) : (
                <View style={styles.classChips}>
                  {classes.map((c) => {
                    const active = c.id === classId;
                    return (
                      <Pressable
                        key={c.id}
                        onPress={() => setClassId(c.id)}
                        style={[styles.chip, active && styles.chipActive]}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>
                          {c.name}
                          {c.section ? ` (${c.section})` : ""}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>

            <View style={styles.badges}>
              <View style={styles.badge}>
                <Text style={styles.badgeValue}>{rows.length}</Text>
                <Text style={styles.badgeLabel}>Students</Text>
              </View>
              <View style={styles.badge}>
                <Text style={styles.badgeValue}>{totals.totalDays}</Text>
                <Text style={styles.badgeLabel}>Total Days</Text>
              </View>
              <View style={styles.badgeTotal}>
                <Text style={styles.badgeValue}>{totals.avg}%</Text>
                <Text style={styles.badgeLabel}>Avg Attendance</Text>
              </View>
            </View>

            {/* Class-wise monthly summary */}
            <View style={styles.summaryCard}>
              <View style={styles.summaryTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.summaryTitle} numberOfLines={1}>
                    {selectedClass
                      ? `${selectedClass.name}${
                          selectedClass.section ? ` (${selectedClass.section})` : ""
                        }`
                      : "Class"}
                  </Text>
                  <Text style={styles.summarySub}>
                    Month (BS):{" "}
                    <Text style={{ fontWeight: "900", color: Colors.textPrimary }}>{monthBs}</Text>
                  </Text>
                </View>

                <View style={styles.summaryPill}>
                  <Ionicons name="stats-chart-outline" size={16} color={Colors.primary} />
                  <Text style={styles.summaryPillText}>{overallRate}%</Text>
                </View>
              </View>

              <View style={styles.summaryGrid}>
                <View style={styles.summaryBox}>
                  <Text style={styles.summaryValue}>{sumPresent}</Text>
                  <Text style={styles.summaryLabel}>Total Present</Text>
                </View>

                <View style={styles.summaryBox}>
                  <Text style={styles.summaryValue}>{sumAbsent}</Text>
                  <Text style={styles.summaryLabel}>Total Absent</Text>
                </View>

                <View style={styles.summaryBox}>
                  <Text style={styles.summaryValue}>{sumTotal}</Text>
                  <Text style={styles.summaryLabel}>Total Marks</Text>
                </View>
              </View>

              <View style={styles.summaryFooter}>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${overallRate}%` }]} />
                </View>
                <Text style={styles.summaryFooterText}>
                  Overall attendance rate for this month (based on all students)
                </Text>
              </View>
            </View>

            <Text style={styles.listTitle}>Students</Text>
            <Text style={styles.listSub}>Swipe anywhere to scroll • Tap a card to view details later</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="document-text-outline" size={28} color={Colors.textSecondary} />
            <Text style={styles.emptyTitle}>No data</Text>
            <Text style={styles.emptySubtitle}>
              Take attendance for this month, then come back here.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardName} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.cardMeta}>
                  Roll <Text style={{ fontWeight: "900" }}>{item.rollNo}</Text>
                </Text>
              </View>

              <View style={styles.percentPill}>
                <Text style={styles.percentText}>{item.percentage}%</Text>
              </View>
            </View>

            {/* Subtle progress bar */}
            <View style={styles.progressWrap} accessibilityLabel="Attendance progress">
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${Math.min(100, Math.max(0, item.percentage))}%` },
                  ]}
                />
              </View>
              <Text style={styles.progressHint}>
                {item.present} present • {item.absent} absent • {item.total} days
              </Text>
            </View>

            <View style={styles.cardStats}>
              <View style={[styles.stat, styles.statPresent]}>
                <Text style={[styles.statValue, styles.statValuePresent]}>{item.present}</Text>
                <Text style={[styles.statLabel, styles.statLabelPresent]}>Present</Text>
              </View>

              <View style={[styles.stat, styles.statAbsent]}>
                <Text style={[styles.statValue, styles.statValueAbsent]}>{item.absent}</Text>
                <Text style={[styles.statLabel, styles.statLabelAbsent]}>Absent</Text>
              </View>

              <View style={styles.stat}>
                <Text style={styles.statValue}>{item.total}</Text>
                <Text style={styles.statLabel}>Total</Text>
              </View>
            </View>
          </View>
        )}
      />
    </Screen>
  );

}

const styles = StyleSheet.create({
  listContent: { paddingBottom: 28 },
  container: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },

  headerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  title: { fontSize: 20, fontWeight: "900", color: Colors.textPrimary },
  subtitle: { fontSize: 12, color: Colors.textSecondary, marginTop: 3 },

  exportBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  exportBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  exportBtnLocked: { backgroundColor: "#FFFFFF", borderColor: Colors.border },
  exportText: { fontWeight: "900", fontSize: 12 },
  exportHint: { marginTop: 6, marginBottom: 6, color: Colors.textSecondary, fontSize: 12, fontWeight: "800", lineHeight: 16 },

  controls: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 18,
    padding: 12,
    backgroundColor: "#FFFFFF",
    gap: 10,
    marginBottom: 12,
  },

  pickerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#F8FAFC",
  },
  pickerText: { fontWeight: "900", color: Colors.textPrimary },

  emptyMini: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  emptyMiniText: { color: Colors.textSecondary, fontWeight: "800", fontSize: 12 },

  classChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipActive: { borderColor: Colors.primary, backgroundColor: "#EEF2FF" },
  chipText: { fontWeight: "900", color: Colors.textSecondary, fontSize: 12 },
  chipTextActive: { color: Colors.primary },

  badges: { flexDirection: "row", gap: 10, marginBottom: 12 },
  listTitle: { fontSize: 14, fontWeight: "900", color: Colors.textPrimary, marginBottom: 4 },
  listSub: { fontSize: 12, color: Colors.textSecondary, fontWeight: "800", marginBottom: 10 },
  badge: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: "#FFFFFF",
    paddingVertical: 10,
    alignItems: "center",
  },
  badgeTotal: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: "#F8FAFC",
    paddingVertical: 10,
    alignItems: "center",
  },
  badgeValue: { fontSize: 16, fontWeight: "900", color: Colors.textPrimary },
  badgeLabel: { marginTop: 2, fontSize: 11, fontWeight: "800", color: Colors.textSecondary },

  card: {
    marginHorizontal: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: "#FFFFFF",
    padding: 12,
    marginBottom: 10,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  cardName: { fontSize: 14, fontWeight: "900", color: Colors.textPrimary },
  cardMeta: { marginTop: 3, fontSize: 12, color: Colors.textSecondary, fontWeight: "800" },

  percentPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#EEF2FF",
    borderWidth: 1,
    borderColor: "#C7D2FE",
  },
  percentText: { fontWeight: "900", fontSize: 12, color: Colors.primary },

  cardStats: { flexDirection: "row", gap: 10 },

  // --- Subtle progress bar ---
  progressWrap: { gap: 6, marginBottom: 10 },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: "#EEF2FF",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#C7D2FE",
  },
  progressFill: {
    height: 8,
    borderRadius: 999,
    backgroundColor: Colors.primary,
  },
  progressHint: { fontSize: 11, fontWeight: "800", color: Colors.textSecondary },

  // --- Present/Absent color boxes ---
  statPresent: { backgroundColor: "#ECFDF3", borderColor: "#ABEFC6" },
  statAbsent: { backgroundColor: "#FEF2F2", borderColor: "#FECACA" },
  statValuePresent: { color: "#067647" },
  statValueAbsent: { color: "#B42318" },
  statLabelPresent: { color: "#067647" },
  statLabelAbsent: { color: "#B42318" },

  // --- Class-wise summary card ---
  summaryCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: "#FFFFFF",
    padding: 12,
    marginBottom: 12,
    gap: 10,
  },
  summaryTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  summaryTitle: { fontSize: 14, fontWeight: "900", color: Colors.textPrimary },
  summarySub: { marginTop: 3, fontSize: 12, color: Colors.textSecondary, fontWeight: "800" },
  summaryPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#EEF2FF",
    borderWidth: 1,
    borderColor: "#C7D2FE",
  },
  summaryPillText: { fontWeight: "900", fontSize: 12, color: Colors.primary },

  summaryGrid: { flexDirection: "row", gap: 10 },
  summaryBox: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: "#F8FAFC",
    paddingVertical: 10,
    alignItems: "center",
  },
  summaryValue: { fontWeight: "900", color: Colors.textPrimary, fontSize: 14 },
  summaryLabel: { marginTop: 2, fontWeight: "800", color: Colors.textSecondary, fontSize: 11 },

  summaryFooter: { gap: 6 },
  summaryFooterText: { fontSize: 11, fontWeight: "800", color: Colors.textSecondary },
  stat: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: "#F8FAFC",
    paddingVertical: 10,
    alignItems: "center",
  },
  statValue: { fontWeight: "900", color: Colors.textPrimary, fontSize: 14 },
  statLabel: { marginTop: 2, fontWeight: "800", color: Colors.textSecondary, fontSize: 11 },

  empty: { alignItems: "center", paddingVertical: 36, gap: 8, marginHorizontal: 16 },
  emptyTitle: { fontSize: 16, fontWeight: "900", color: Colors.textPrimary },
  emptySubtitle: { textAlign: "center", color: Colors.textSecondary, marginTop: 2 },
});