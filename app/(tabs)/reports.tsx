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
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";

import Screen from "../../src/components/Screen";
import AppHeader from "../../src/components/AppHeader";
import { Colors } from "../../src/constants/colors";
import { validatePremiumEntitlement } from "../../src/premium/license";
import { useTenant } from "../../src/tenant/TenantContext";
import { listClasses, type ClassItem } from "../../src/db/classRepo";
import {
  getMonthlyAttendanceSummary,
  type MonthlyStudentSummary,
} from "../../src/db/reportRepo";
import { getDb } from "../../src/db/db";

type StudentMonthDetails = {
  presentDates: string[];
  absentDates: string[];
  leaveDates: string[];
  sickDates: string[];
  unmarkedDates: string[];
  totalSessions: number;
};

function todayBs(): string {
  return new NepaliDate().format("YYYY-MM-DD");
}

// dateBs: "YYYY-MM-DD" => monthBs: "YYYY-MM"
function monthFromBsDate(dateBs: string): string {
  return String(dateBs).slice(0, 7);
}

function isFutureBs(bs: string): boolean {
  try {
    const selectedDate = new NepaliDate(bs.trim()).toJsDate();
    selectedDate.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return selectedDate.getTime() > today.getTime();
  } catch {
    return false;
  }
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
  lastVerifiedAt: number | null;
  graceUntil: number | null;
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

      const lastVerifiedAtRaw = obj?.lastVerifiedAt ?? obj?.lastVerified ?? null;
      const lastVerifiedAt =
        lastVerifiedAtRaw === null || lastVerifiedAtRaw === undefined
          ? null
          : Number(lastVerifiedAtRaw);

      const graceUntilRaw = obj?.graceUntil ?? obj?.graceUntilAt ?? null;
      const graceUntil =
        graceUntilRaw === null || graceUntilRaw === undefined
          ? null
          : Number(graceUntilRaw);

      return {
        premium,
        expiresAt: Number.isFinite(expiresAt) ? expiresAt : null,
        lastVerifiedAt: Number.isFinite(lastVerifiedAt as any) ? (lastVerifiedAt as any) : null,
        graceUntil: Number.isFinite(graceUntil as any) ? (graceUntil as any) : null,
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

  // Student-wise monthly details (tap a student card)
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailStudent, setDetailStudent] = useState<MonthlyStudentSummary | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<StudentMonthDetails | null>(null);

  // Premium status from cached entitlement (offline)
  useEffect(() => {
    let mounted = true;

    (async () => {
      const ent = await readPremiumEntitlement();
      const { valid } = validatePremiumEntitlement(ent);
      const ok = valid;

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
    // Future dates are disabled by maxDate; keep this as a silent safeguard.
    if (isFutureBs(picked)) return;

    setMonthBs(monthFromBsDate(picked));
    setPickerOpen(false);
  };

  const loadStudentMonthDetails = useCallback(
    async (studentId: string): Promise<StudentMonthDetails> => {
      if (!tenantId || !classId) {
        return {
          presentDates: [],
          absentDates: [],
          leaveDates: [],
          sickDates: [],
          unmarkedDates: [],
          totalSessions: 0,
        };
      }

      const db = await getDb();
      const like = `${monthBs}-%`;

      const sessionRows = await db.getAllAsync<{
        dateBs: string;
        status: string | null;
      }>(
        `
        SELECT
          asess.dateBs AS dateBs,
          ar.status AS status
        FROM attendance_sessions asess
        LEFT JOIN attendance_records ar
          ON ar.sessionId = asess.id
         AND ar.studentId = ?
        WHERE asess.tenantId = ?
          AND asess.classId = ?
          AND asess.dateBs LIKE ?
        ORDER BY asess.dateBs ASC;
        `,
        [studentId, tenantId, classId, like]
      );

      const presentDates: string[] = [];
      const absentDates: string[] = [];
      const leaveDates: string[] = [];
      const sickDates: string[] = [];
      const unmarkedDates: string[] = [];

      for (const r of sessionRows) {
        if (r.status === "P") presentDates.push(r.dateBs);
        else if (r.status === "A") absentDates.push(r.dateBs);
        else if (r.status === "L") leaveDates.push(r.dateBs);
        else if (r.status === "S") sickDates.push(r.dateBs);
        else unmarkedDates.push(r.dateBs);
      }

      return {
        presentDates,
        absentDates,
        leaveDates,
        sickDates,
        unmarkedDates,
        totalSessions: sessionRows.length,
      };
    },
    [tenantId, classId, monthBs]
  );

  const openStudentDetails = useCallback(
    async (student: MonthlyStudentSummary) => {
      setDetailStudent(student);
      setDetail(null);
      setDetailOpen(true);

      try {
        setDetailLoading(true);
        const d = await loadStudentMonthDetails(student.studentId);
        setDetail(d);
      } catch (e: any) {
        Alert.alert("Error", e?.message ?? "Failed to load student details");
      } finally {
        setDetailLoading(false);
      }
    },
    [loadStudentMonthDetails]
  );
const EXPORT_DIR_KEY = "ATTENDANCE_EXPORT_DIR_URI";

async function saveCsvToDownloads(fileName: string, csv: string) {
  // Android: use Storage Access Framework so user chooses folder once
  if (Platform.OS === "android" && FileSystem.StorageAccessFramework) {
    const cached = await AsyncStorage.getItem(EXPORT_DIR_KEY);

    const writeToDir = async (dirUri: string) => {
      const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
        dirUri,
        fileName,
        "text/csv"
      );
      await FileSystem.writeAsStringAsync(fileUri, csv, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      // Optional share copy
      try {
        if (Sharing && (await Sharing.isAvailableAsync())) {
          const shareUri = `${FileSystem.cacheDirectory}${fileName}`;
          await FileSystem.writeAsStringAsync(shareUri, csv, {
            encoding: FileSystem.EncodingType.UTF8,
          });
          await Sharing.shareAsync(shareUri);
        }
      } catch {
        // ignore share errors
      }
    };

    if (cached) {
      try {
        await writeToDir(cached);
        return;
      } catch {
        await AsyncStorage.removeItem(EXPORT_DIR_KEY);
      }
    }

    const perm =
      await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!perm.granted) {
      throw new Error("Folder permission not granted.");
    }
    await AsyncStorage.setItem(EXPORT_DIR_KEY, perm.directoryUri);
    await writeToDir(perm.directoryUri);
    return;
  }

  // iOS / others: save to cache and share
  const uri = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(uri, csv, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  if (Sharing && (await Sharing.isAvailableAsync())) {
    await Sharing.shareAsync(uri);
  } else {
    Alert.alert("Saved", `Saved to: ${uri}`);
  }
}

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

    // Match the sample export:
    // - No missing days (all dates in the BS month are present)
    // - Saturdays show "Saturday"
    // - Holidays show the holiday title (entered by the class teacher)
    // - Attendance Percentage is exported as a human-friendly percent (e.g. 81.3%)
    const round1 = (n: number) => Math.round(n * 10) / 10;

    const formatPercent = (attended: number, held: number) => {
      const pct = held ? round1((attended / held) * 100) : 0;
      // Avoid showing trailing .0
      return `${Number.isInteger(pct) ? String(pct) : pct.toFixed(1)}%`;
    };

    try {
      const { buildMonthlyMatrix, dateColLabel } = await import("../../src/db/reportRepo");

      const { sessions, students, statusMap } = await buildMonthlyMatrix({
        tenantId,
        classId: selectedClass.id,
        monthBs,
      });

      if (students.length === 0) {
        Alert.alert("Nothing to export", "No students found for this class.");
        return;
      }

      const dateCols = sessions.map((s) => dateColLabel(s.dateBs));
      const header = [
        "Roll",
        "Name",
        "Classes Held",
        "Classes Attended",
        "Attendance Percentage",
        ...dateCols,
      ];

      const csvRows: string[] = [];
      csvRows.push(header.map(csvEscape).join(","));

      const classesHeld = sessions.filter((s: any) => (s?.dayType ?? "CLASS") === "CLASS").length;

      for (const st of students) {
        let attended = 0;
        const cells: string[] = [];

        for (const s of sessions as any[]) {
          const dt = (s as any)?.dayType ?? "CLASS";

          if (dt === "WEEKLY_OFF") {
            cells.push("Saturday");
            continue;
          }

          if (dt === "HOLIDAY") {
            // Prefer teacher-entered title. If missing for some reason, fall back to "Holiday".
            const title = String((s as any)?.holidayTitle ?? "").trim();
            cells.push(title || "Holiday");
            continue;
          }

          const key = `${st.id}__${s.dateBs}`;
          const status = String(statusMap.get(key) ?? "").toUpperCase();
          if (status === "P") attended += 1;
          if (status === "A" || status === "P" || status === "L" || status === "S") {
            cells.push(status);
          } else {
            cells.push("");
          }
        }

        const pct = formatPercent(attended, classesHeld);

        const row = [st.rollNo, st.name, classesHeld, attended, pct, ...cells];
        csvRows.push(row.map(csvEscape).join(","));
      }

      const className = selectedClass.name ?? "";
      const csv = csvRows.join("\n");
      const fileName = `🏫${className}_Attendance_Report_${monthBs}.csv`;

      await saveCsvToDownloads(fileName, csv);
      Alert.alert("Exported", `Saved: ${fileName}`);
    } catch (e: any) {
      Alert.alert("Export failed", e?.message ?? "Could not export CSV.");
    }
  }

  if (!tenant) return null;

  return (
    <Screen>
      <AppHeader name={tenant.schoolName} address={tenant.schoolAddress} />

      <CalendarPicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onDateSelect={onPickDate}
        date={`${monthBs}-01`}
        maxDate={todayBs()}
        brandColor={Colors.primary}
        // @ts-ignore
        language="nepali"
      />

      {/* Student-wise monthly details */}
      {detailOpen ? (
        <Modal visible={detailOpen} transparent animationType="fade" onRequestClose={() => setDetailOpen(false)}>
          <Pressable style={styles.modalBackdrop} onPress={() => setDetailOpen(false)}>
            <Pressable style={styles.detailModal} onPress={() => {}}>
              <View style={styles.detailHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.detailTitle} numberOfLines={1}>
                    {detailStudent?.name ?? "Student"}
                  </Text>
                  <Text style={styles.detailSub}>
                    Roll {detailStudent?.rollNo ?? "-"} • Month (BS): {monthBs}
                  </Text>
                </View>
                <Pressable onPress={() => setDetailOpen(false)} style={styles.detailCloseBtn}>
                  <Ionicons name="close" size={20} color={Colors.textPrimary} />
                </Pressable>
              </View>

              {detailLoading ? (
                <Text style={styles.detailLoading}>Loading…</Text>
              ) : !detailStudent || !detail ? (
                <Text style={styles.detailLoading}>No details</Text>
              ) : (
                <View style={{ gap: 12 }}>
                  <View style={styles.detailBadges}>
                    <View style={styles.detailBadge}>
                      <Text style={styles.detailBadgeValue}>{detail.presentDates.length}</Text>
                      <Text style={styles.detailBadgeLabel}>Present</Text>
                    </View>
                    <View style={styles.detailBadge}>
                      <Text style={styles.detailBadgeValue}>{detail.absentDates.length}</Text>
                      <Text style={styles.detailBadgeLabel}>Absent</Text>
                    </View>
                    <View style={styles.detailBadge}>
                      <Text style={styles.detailBadgeValue}>{detail.leaveDates.length}</Text>
                      <Text style={styles.detailBadgeLabel}>Leave</Text>
                    </View>
                    <View style={styles.detailBadge}>
                      <Text style={styles.detailBadgeValue}>{detail.sickDates.length}</Text>
                      <Text style={styles.detailBadgeLabel}>Sick</Text>
                    </View>
                    <View style={styles.detailBadge}>
                      <Text style={styles.detailBadgeValue}>{detail.unmarkedDates.length}</Text>
                      <Text style={styles.detailBadgeLabel}>Unmarked</Text>
                    </View>
                    <View style={styles.detailBadgeTotal}>
                      <Text style={styles.detailBadgeValue}>{detail.totalSessions}</Text>
                      <Text style={styles.detailBadgeLabel}>Total Days</Text>
                    </View>
                  </View>

                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionTitle}>Present dates</Text>
                    <Text style={styles.detailDates}>
                      {detail.presentDates.length ? detail.presentDates.join(", ") : "-"}
                    </Text>
                  </View>

                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionTitle}>Absent dates</Text>
                    <Text style={styles.detailDates}>
                      {detail.absentDates.length ? detail.absentDates.join(", ") : "-"}
                    </Text>
                  </View>

                  {/* unmarked dates are optional to show; counts above always show */}
                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionTitle}>Unmarked dates</Text>
                    <Text style={styles.detailDates}>
                      {detail.unmarkedDates.length ? detail.unmarkedDates.join(", ") : "-"}
                    </Text>
                  </View>
                </View>
              )}
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
          <Pressable
            onPress={() => openStudentDetails(item)}
            style={styles.card}
          >
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
          </Pressable>
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

  // --- Modals ---
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    padding: 16,
  },
  modalCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  modalTitle: { fontSize: 16, fontWeight: "900", color: Colors.textPrimary },
  modalClose: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: "#F8FAFC",
  },

  // Student details modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    padding: 16,
  },
  detailModal: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10,
  },
  detailHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  detailTitle: { fontSize: 16, fontWeight: "900", color: Colors.textPrimary },
  detailSub: { marginTop: 3, fontSize: 12, fontWeight: "800", color: Colors.textSecondary },
  detailCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: "#F8FAFC",
  },
  detailLoading: { fontSize: 12, fontWeight: "800", color: Colors.textSecondary, paddingVertical: 10 },
  detailBadges: { flexDirection: "row", gap: 10 },
  detailBadge: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: "#F8FAFC",
    paddingVertical: 10,
    alignItems: "center",
  },
  detailBadgeTotal: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#C7D2FE",
    backgroundColor: "#EEF2FF",
    paddingVertical: 10,
    alignItems: "center",
  },
  detailBadgeValue: { fontWeight: "900", color: Colors.textPrimary, fontSize: 14 },
  detailBadgeLabel: { marginTop: 2, fontWeight: "800", color: Colors.textSecondary, fontSize: 11 },
  detailSection: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    padding: 12,
    gap: 6,
  },
  detailSectionTitle: { fontWeight: "900", color: Colors.textPrimary, fontSize: 12 },
  detailDates: { color: Colors.textSecondary, fontWeight: "800", fontSize: 12, lineHeight: 18 },

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