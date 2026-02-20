// app/(tabs)/attendance.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  FlatList,
  Alert,
  StyleSheet,
  Platform,
  Switch,
} from "react-native";
import { randomUUID } from "expo-crypto";
import NepaliDate from "nepali-date-converter";
import { Ionicons } from "@expo/vector-icons";
import { CalendarPicker } from "react-native-nepali-picker";
import { useFocusEffect } from "@react-navigation/native";
import NetInfo from "@react-native-community/netinfo";
import AsyncStorage from "@react-native-async-storage/async-storage";

import Screen from "../../src/components/Screen";
import AppHeader from "../../src/components/AppHeader";
import { Colors } from "../../src/constants/colors";
import { APP_CONFIG } from "../../src/constants/appConfig";
import { validatePremiumEntitlement } from "../../src/premium/license";
import { readPremiumEntitlement } from "../../src/premium/readEntitlement";
import { useTenant } from "../../src/tenant/TenantContext";
import { listClasses, ClassItem } from "../../src/db/classRepo";
import { listStudents, StudentItem } from "../../src/db/studentRepo";
import {
  getSessionByBsDate,
  getRecordsForSession,
  saveAttendanceForDate,
  type AttendanceStatus,
} from "../../src/db/attendanceRepo";

import {
  getSmsEnabled,
  setSmsEnabled,
  enqueueSmsBatch,
  countQueuedForClassAndDate,
  listQueued,
  markSent,
  markFailed,
} from "../../src/db/smsRepo";

function todayBs(): string {
  return new NepaliDate().format("YYYY-MM-DD");
}

function toIsoDate(d: Date): string {
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function bsToAdIso(dateBs: string): string {
  const js = new NepaliDate(dateBs).toJsDate();
  return toIsoDate(js);
}

function isValidBs(bs: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(bs.trim());
}

export default function AttendanceScreen() {
  const { tenant } = useTenant();
  const smsAllowedForSchool = !!tenant?.features?.smsAlertsEnabled;
  if (!tenant) return null;

  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>("");

  const [students, setStudents] = useState<StudentItem[]>([]);
  const [statusByStudentId, setStatusByStudentId] = useState<
    Record<string, AttendanceStatus>
  >({});

  // ✅ Past attendance editing (by BS date)
  const [dateBs, setDateBs] = useState<string>(() => todayBs());
  const [pickerOpen, setPickerOpen] = useState(false);

  // --- SMS Alerts (Premium) per class ---
  const [smsOn, setSmsOn] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);

  const [smsTemplate, setSmsTemplate] = useState<string>(
    "Dear Parent, your child {studentName} (class {className}) is absent today. {bsDate} {schoolName}"
  );

    const SMS_TEMPLATE_KEY = (tenantId: string) => `smsTemplate:${tenantId}`;

useEffect(() => {
    if (!tenant?.tenantId) return;
    AsyncStorage.getItem(SMS_TEMPLATE_KEY(tenant.tenantId))
      .then((v) => {
        if (v && v.trim()) setSmsTemplate(v);
      })
      .catch(() => {});
  }, [tenant?.tenantId]);

  const [autoSending, setAutoSending] = useState(false);

  const dateAd = useMemo(() => {
    try {
      return isValidBs(dateBs) ? bsToAdIso(dateBs) : "";
    } catch {
      return "";
    }
  }, [dateBs]);

  const selectedClass = useMemo(
    () => classes.find((c) => c.id === selectedClassId),
    [classes, selectedClassId]
  );



const isPremiumValid = useCallback(async () => {
  const ent = await readPremiumEntitlement();
  const { valid } = validatePremiumEntitlement(ent, {
    now: Date.now(),
    graceDays: APP_CONFIG.PREMIUM_GRACE_DAYS ?? 14,
  });
  return valid;
}, []);
  const refreshClasses = async (): Promise<{ rows: ClassItem[]; selectedId: string }> => {
    const rows = await listClasses(tenant.tenantId);
    setClasses(rows);

    let nextSelectedId = selectedClassId;

    if (!nextSelectedId && rows.length > 0) nextSelectedId = rows[0].id;

    // If selected class was deleted, fall back to first
    if (nextSelectedId && !rows.some((c) => c.id === nextSelectedId)) {
      nextSelectedId = rows[0]?.id ?? "";
    }

    if (nextSelectedId !== selectedClassId) setSelectedClassId(nextSelectedId);

    return { rows, selectedId: nextSelectedId };
  };

  // ✅ Refresh classes + students whenever Attendance tab is focused
  // This ensures newly added students/classes show up immediately when returning from other tabs.
  useFocusEffect(
    useCallback(() => {
      let alive = true;

      (async () => {
        const { selectedId } = await refreshClasses();
        if (!alive) return;

        // Refresh students + attendance for the currently selected date
        if (selectedId) {
          await refreshStudents(selectedId);
          if (!alive) return;
          await loadForDate(false, selectedId);
        }
      })();

      return () => {
        alive = false;
      };
    }, [tenant.tenantId, selectedClassId, dateBs])
  );

  const refreshStudents = async (classId: string) => {
    if (!classId) {
      setStudents([]);
      setStatusByStudentId({});
      return [];
    }
    const rows = await listStudents(tenant.tenantId, classId); // rollNo ASC in repo
    setStudents(rows);
    return rows;
  };

  const setDefaultAllPresent = (rows: StudentItem[]) => {
    const initial: Record<string, AttendanceStatus> = {};
    for (const s of rows) initial[s.id] = "P";
    setStatusByStudentId(initial);
  };

  useEffect(() => {
    refreshClasses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant.tenantId]);

  useEffect(() => {
    (async () => {
      const rows = await refreshStudents(selectedClassId);
      if (rows.length > 0) setDefaultAllPresent(rows);

      // Load per-class SMS preference
      if (selectedClassId) {
        const enabled = await getSmsEnabled(tenant.tenantId, selectedClassId);
        setSmsOn(enabled);
      } else {
        setSmsOn(false);
      }

      // Refresh queued count for current class/date
      if (selectedClassId && isValidBs(dateBs)) {
        setQueuedCount(
          await countQueuedForClassAndDate(tenant.tenantId, selectedClassId, dateBs)
        );
      } else {
        setQueuedCount(0);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClassId]);

  // Refresh queued count when date changes
  useEffect(() => {
    (async () => {
      if (selectedClassId && isValidBs(dateBs)) {
        setQueuedCount(
          await countQueuedForClassAndDate(tenant.tenantId, selectedClassId, dateBs)
        );
      } else {
        setQueuedCount(0);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateBs, selectedClassId]);

  const STATUS_ORDER: AttendanceStatus[] = ["P", "A", "L", "S"];

  const toggleStatus = (studentId: string) => {
    setStatusByStudentId((prev) => {
      const cur = prev[studentId] ?? "P";
      const idx = Math.max(0, STATUS_ORDER.indexOf(cur));
      const next = STATUS_ORDER[(idx + 1) % STATUS_ORDER.length];
      return { ...prev, [studentId]: next };
    });
  };

  const markAll = (status: AttendanceStatus) => {
    const next: Record<string, AttendanceStatus> = {};
    for (const s of students) next[s.id] = status;
    setStatusByStudentId(next);
  };

  const loadForDate = async (showAlerts: boolean, classId?: string) => {
    const cid = classId ?? selectedClassId;
    if (!cid) {
      if (showAlerts) Alert.alert("No class selected", "Select a class first.");
      return;
    }
    const bs = dateBs.trim();
    if (!isValidBs(bs)) {
      if (showAlerts)
        Alert.alert("Invalid BS date", "Please pick a valid Nepali date.");
      return;
    }

    const rows = await refreshStudents(cid);
    if (rows.length === 0) {
      if (showAlerts) Alert.alert("No students", "Add students to this class first.");
      return;
    }

    const session = await getSessionByBsDate(tenant.tenantId, cid, bs);
    if (!session) {
      setDefaultAllPresent(rows);
      if (showAlerts)
        Alert.alert("Not found", `No saved attendance for ${bs}. Starting new.`);
      return;
    }

    const records = await getRecordsForSession(session.id);
    const map: Record<string, AttendanceStatus> = {};
    for (const s of rows) map[s.id] = "P"; // default
    for (const r of records) map[r.studentId] = r.status;
    setStatusByStudentId(map);

    if (showAlerts) Alert.alert("Loaded", `Loaded saved attendance for ${bs}.`);
  };

  const onSave = async () => {
    if (!selectedClassId) {
      Alert.alert("No class selected", "Please create/select a class first.");
      return;
    }
    if (students.length === 0) {
      Alert.alert("No students", "Add students to this class first.");
      return;
    }
    const bs = dateBs.trim();
    if (!isValidBs(bs)) {
      Alert.alert("Invalid BS date", "Please pick a valid Nepali date.");
      return;
    }
    if (!dateAd) {
      Alert.alert("Invalid BS date", "Unable to convert this BS date.");
      return;
    }

    const existing = await getSessionByBsDate(tenant.tenantId, selectedClassId, bs);

    const doSave = async () => {
      const records = students.map((s) => ({
        studentId: s.id,
        status: statusByStudentId[s.id] ?? "P",
      }));

      const res = await saveAttendanceForDate({
        sessionId: randomUUID(),
        tenantId: tenant.tenantId,
        classId: selectedClassId,
        dateBs: bs,
        dateAd,
        records,
      });

      Alert.alert(
        "Saved",
        res.overwritten ? `Attendance updated for ${bs}.` : `Attendance saved for ${bs}.`
      );
    };

    if (existing) {
      Alert.alert(
        "Overwrite?",
        `Attendance for ${bs} is already saved for this class. Save again to overwrite?`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Overwrite", style: "destructive", onPress: doSave },
        ]
      );
      return;
    }

    doSave();
  };

  const renderChip = (c: ClassItem) => {
    const active = c.id === selectedClassId;
    return (
      <Pressable
        key={c.id}
        onPress={() => setSelectedClassId(c.id)}
        style={({ pressed }) => [
          styles.chip,
          active ? styles.chipActive : styles.chipInactive,
          pressed && { opacity: 0.9 },
        ]}
      >
        <Text style={[styles.chipText, active && styles.chipTextActive]}>
          {c.name}
          {c.section ? ` (${c.section})` : ""}
        </Text>
      </Pressable>
    );
  };

  const onPickDate = (picked: string) => {
    // Library returns BS date string (YYYY-MM-DD)
    setDateBs(picked);
    setPickerOpen(false);
  };

  const onToggleSms = async (next: boolean) => {
    if (!selectedClassId) return;

    if (!smsAllowedForSchool) {
      Alert.alert("SMS not enabled", "SMS Alerts are disabled for this school.");
      return;
    }

    const ok = await isPremiumValid();
    if (!ok) {
      Alert.alert("Premium required", "SMS Alerts is a Premium feature. Activate Premium in Settings.");
      return;
    }

    await setSmsEnabled(tenant.tenantId, selectedClassId, next);
    setSmsOn(next);
  };

  const queueAbsenteeSms = async () => {
    if (!selectedClassId) {
      Alert.alert("No class selected", "Select a class first.");
      return;
    }

    const ok = await isPremiumValid();
    if (!ok) {
      Alert.alert("Premium required", "SMS Alerts is a Premium feature. Activate Premium in Settings.");
      return;
    }

    if (!smsOn) {
      Alert.alert("SMS is OFF", "Turn ON SMS Alerts for this class first.");
      return;
    }

    const bs = dateBs.trim();
    if (!isValidBs(bs)) {
      Alert.alert("Invalid BS date", "Please pick a valid Nepali date.");
      return;
    }

    const absentees = students.filter(
      (s) => (statusByStudentId[s.id] ?? "P") === "A" && !!(s.phone && String(s.phone).trim())
    );

    if (absentees.length === 0) {
      Alert.alert("No absentees", "No absentees with phone numbers to notify.");
      return;
    }

    const msgs = absentees.map((s) => ({
      id: randomUUID(),
      tenantId: tenant.tenantId,
      classId: selectedClassId,
      studentId: s.id,
      bsDate: bs,
      phone: String(s.phone || "").trim(),
      message: smsTemplate
        .replaceAll("{studentName}", String(s.name ?? ""))
        .replaceAll(
          "{className}",
          selectedClass
            ? `${String(selectedClass.name ?? "")}${selectedClass.section ? String(selectedClass.section) : ""}`
            : ""
        )
        .replaceAll("{rollNo}", String(s.rollNo ?? ""))
        .replaceAll("{bsDate}", String(bs))
        .replaceAll("{schoolName}", String(tenant.schoolName ?? "")),
    }));

    await enqueueSmsBatch(msgs);
    setQueuedCount(await countQueuedForClassAndDate(tenant.tenantId, selectedClassId, bs));

    Alert.alert("Queued", `Queued ${msgs.length} SMS. Auto-send will happen when internet is available.`);
  };

  const sendQueuedToServer = async () => {
    const ok = await isPremiumValid();
    if (!ok) return;

    const baseUrl = (APP_CONFIG as any).SMS_API_BASE_URL || APP_CONFIG.API_BASE_URL;
    if (!baseUrl) return;

    const queued = await listQueued(50);
    if (queued.length === 0) return;

    // Only send rows for classes that have SMS enabled (per class)
    const filtered = [];
    for (const q of queued) {
      const enabled = await getSmsEnabled(q.tenantId, q.classId);
      if (enabled) filtered.push(q);
    }
    if (filtered.length === 0) return;

    try {
      setAutoSending(true);
      const res = await fetch(`${baseUrl}/api/sms/queueBatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: tenant.tenantId,
          deviceId: tenant.deviceId || "unknown-device",
          items: filtered.map((m) => ({
            to: m.phone,
            text: m.message,
          })),
        }),
      });

      const text = await res.text();
      if (!res.ok) {
        for (const m of filtered) {
          await markFailed(m.id, text || `HTTP ${res.status}`);
        }
        return;
      }

      await markSent(filtered.map((m) => m.id));

      if (selectedClassId && isValidBs(dateBs)) {
        setQueuedCount(
          await countQueuedForClassAndDate(tenant.tenantId, selectedClassId, dateBs)
        );
      }
    } catch {
      // network error: keep queued for later
    } finally {
      setAutoSending(false);
    }
  };

  // ✅ Option B: Auto-send when internet becomes available
  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      if (state.isConnected) {
        sendQueuedToServer();
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant.tenantId]);

  return (
    <Screen>
      <AppHeader name={tenant.schoolName} address={tenant.schoolAddress} />

      {/* BS Date Picker modal */}
      <CalendarPicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onDateSelect={onPickDate}
        brandColor={Colors.primary}
      />

      <FlatList
        data={students}
        keyExtractor={(s) => s.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            <View>
              <Text style={styles.title}>Attendance</Text>

              {/* Date row */}
              <View style={styles.dateRow}>
                <Pressable
                  onPress={() => setPickerOpen(true)}
                  style={({ pressed }) => [
                    styles.dateInputLike,
                    pressed && { opacity: 0.92 },
                  ]}
                >
                  <Ionicons name="calendar" size={18} color={Colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dateLabel}>Date (BS)</Text>
                    <Text style={styles.dateValue}>{dateBs}</Text>
                    <Text style={styles.subtleSmall}>
                      AD: <Text style={styles.subtleStrong}>{dateAd || "-"}</Text>
                    </Text>
                  </View>
                  <Ionicons name="chevron-down" size={18} color={Colors.textSecondary} />
                </Pressable>

                <View style={styles.dateBtnCol}>
                  <Pressable
                    onPress={() => setDateBs(todayBs())}
                    style={({ pressed }) => [
                      styles.secondarySmallBtn,
                      pressed && { opacity: 0.9 },
                    ]}
                  >
                    <Text style={styles.secondarySmallBtnText}>Today</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => loadForDate(true)}
                    style={({ pressed }) => [
                      styles.secondarySmallBtn,
                      pressed && { opacity: 0.9 },
                    ]}
                  >
                    <Text style={styles.secondarySmallBtnText}>Load</Text>
                  </Pressable>
                </View>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Class</Text>
              {classes.length === 0 ? (
                <Text style={styles.subtle}>No classes yet. Add a class first.</Text>
              ) : (
                <View style={styles.chipWrap}>{classes.map(renderChip)}</View>
              )}

              {!!selectedClass && (
                <Text style={styles.subtleSmall}>
                  Selected:{" "}
                  <Text style={styles.subtleStrong}>
                    {selectedClass.name}
                    {selectedClass.section ? ` (${selectedClass.section})` : ""}
                  </Text>
                </Text>
              )}

              {/* SMS Alerts (Premium) - per class */}
              {selectedClassId ? (
                <View style={styles.smsCard}>
                  <View style={styles.smsTopRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.smsTitle}>SMS Alerts (Premium)</Text>
                      <Text style={styles.smsSub}>
                        Per class toggle • Auto-send when online
                      </Text>
                      {!smsAllowedForSchool ? (
                        <Text style={styles.smsHint}>SMS Alerts are disabled for this school.</Text>
                      ) : null}
                    </View>

                    <View style={styles.smsToggleRow}>
                      <Text style={styles.smsToggleText}>{smsOn ? "ON" : "OFF"}</Text>
                      <Switch
                        value={smsOn}
                        onValueChange={onToggleSms}
                        disabled={!smsAllowedForSchool}
                        trackColor={{ false: Colors.border, true: Colors.primary }}
                        thumbColor={Platform.OS === "android" ? "#fff" : undefined}
                      />
                    </View>
                  </View>

                  <View style={styles.smsBottomRow}>
                    <View style={styles.smsPill}>
                      <Ionicons name="time-outline" size={16} color={Colors.textSecondary} />
                      <Text style={styles.smsPillText}>Queued: {queuedCount}</Text>
                    </View>

                    <View style={styles.smsPill}>
                      <Ionicons name="cloud-upload-outline" size={16} color={Colors.textSecondary} />
                      <Text style={styles.smsPillText}>
                        {autoSending ? "Sending…" : "Auto-send"}
                      </Text>
                    </View>

                    <Pressable
                      onPress={queueAbsenteeSms}
                      style={({ pressed }) => [
                        styles.smsBtn,
                        pressed && { opacity: 0.9 },
                      ]}
                    >
                      <Ionicons name="chatbubble-ellipses-outline" size={18} color="#fff" />
                      <Text style={styles.smsBtnText}>Queue absentees</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </View>

            {!!selectedClassId && students.length > 0 ? (
              <View style={styles.actionsRow}>
                <Pressable
                  onPress={() => markAll("P")}
                  style={({ pressed }) => [
                    styles.secondaryBtn,
                    pressed && { opacity: 0.9 },
                  ]}
                >
                  <Text style={styles.secondaryBtnText}>All Present</Text>
                </Pressable>
                <Pressable
                  onPress={() => markAll("A")}
                  style={({ pressed }) => [
                    styles.secondaryBtn,
                    pressed && { opacity: 0.9 },
                  ]}
                >
                  <Text style={styles.secondaryBtnText}>All Absent</Text>
                </Pressable>
                <Pressable
                  onPress={onSave}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    pressed && { opacity: 0.9 },
                  ]}
                >
                  <Text style={styles.primaryBtnText}>Save</Text>
                </Pressable>
              </View>
            ) : null}

            <Text style={styles.sectionTitle}>Students</Text>
            <Text style={styles.subtleSmall}>Tap a student to cycle status (Present → Absent → Leave → Sick).</Text>
          </View>
        }
        renderItem={({ item }) => {
          const status = statusByStudentId[item.id] ?? "P";

          const statusLabel = (() => {
            switch (status) {
              case "A":
                return "Absent";
              case "L":
                return "Leave";
              case "S":
                return "Sick";
              default:
                return "Present";
            }
          })();

          const statusPillStyle = (() => {
            switch (status) {
              case "A":
                return styles.statusAbsent;
              case "L":
                return styles.statusLeave;
              case "S":
                return styles.statusSick;
              default:
                return styles.statusPresent;
            }
          })();

          const statusTextStyle = (() => {
            switch (status) {
              case "A":
                return styles.statusTextAbsent;
              case "L":
                return styles.statusTextLeave;
              case "S":
                return styles.statusTextSick;
              default:
                return styles.statusTextPresent;
            }
          })();

          return (
            <Pressable
              onPress={() => toggleStatus(item.id)}
              style={({ pressed }) => [
                styles.studentRow,
                pressed && { opacity: 0.92 },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.studentName} numberOfLines={1}>
                  {item.rollNo}. {item.name}
                </Text>
                {!!item.parentName && (
                  <Text style={styles.meta} numberOfLines={1}>
                    Parent: {item.parentName}
                  </Text>
                )}
              </View>

              <View style={[styles.statusPill, statusPillStyle]}>
                <Text style={[styles.statusText, statusTextStyle]}>
                  {statusLabel}
                </Text>
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={{ paddingTop: 12, gap: 6 }}>
            <Text style={styles.emptyTitle}>
              {selectedClassId ? "No students found" : "Select a class"}
            </Text>
            <Text style={styles.subtle}>
              {selectedClassId
                ? "Add students to this class from Students tab."
                : "Choose a class to take attendance."}
            </Text>
          </View>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 28, gap: 12 },

  title: { fontSize: 22, fontWeight: "800", color: Colors.textPrimary },
  subtle: { marginTop: 4, color: Colors.textSecondary, lineHeight: 18 },
  subtleSmall: { color: Colors.textSecondary, fontSize: 12, marginTop: 6 },
  subtleStrong: { color: Colors.primary, fontWeight: "900" },

  sectionTitle: { fontSize: 14, fontWeight: "900", color: Colors.textPrimary },

  dateRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  dateBtnCol: { gap: 10, paddingTop: 4 },
  dateInputLike: {
    flex: 1,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  dateLabel: { fontSize: 12, fontWeight: "900", color: Colors.textSecondary },
  dateValue: { fontSize: 16, fontWeight: "900", color: Colors.textPrimary, marginTop: 2 },

  secondarySmallBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: "center",
  },
  secondarySmallBtnText: { fontWeight: "900", color: Colors.textPrimary, fontSize: 12 },

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

  // --- SMS Styles ---
  smsCard: {
    marginTop: 12,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    gap: 10,
  },
  smsTopRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  smsTitle: { fontSize: 13, fontWeight: "900", color: Colors.textPrimary },
  smsSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  smsHint: { fontSize: 12, fontWeight: "800", color: Colors.textSecondary, marginTop: 6 },
  smsToggleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  smsToggleText: { fontSize: 12, fontWeight: "900", color: Colors.textSecondary },

  smsBottomRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 },
  smsPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  smsPillText: { fontSize: 12, fontWeight: "800", color: Colors.textSecondary },

  smsBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: Colors.primary,
  },
  smsBtnText: { color: "#fff", fontWeight: "900", fontSize: 12 },

  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1 },
  chipInactive: { backgroundColor: Colors.surface, borderColor: Colors.border },
  chipActive: { backgroundColor: Colors.primarySoft, borderColor: "#C7D2FE" },
  chipText: { fontWeight: "800", color: Colors.textPrimary },
  chipTextActive: { color: Colors.primary },

  actionsRow: { flexDirection: "row", gap: 10, alignItems: "center" },
  secondaryBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: "center",
  },
  secondaryBtnText: { fontWeight: "900", color: Colors.textPrimary, fontSize: 12 },

  primaryBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
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

  studentRow: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.05,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 7 },
      },
      android: { elevation: 2 },
      default: {},
    }),
  },
  studentName: { fontSize: 15, fontWeight: "900", color: Colors.textPrimary },
  meta: { marginTop: 3, fontSize: 12.5, color: Colors.textSecondary },

  statusPill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
  statusPresent: { backgroundColor: "#ECFDF3", borderColor: "#ABEFC6" },
  statusAbsent: { backgroundColor: "#FEF2F2", borderColor: "#FECACA" },
  statusLeave: { backgroundColor: "#FFFAEB", borderColor: "#FCD34D" },
  statusSick: { backgroundColor: "#EEF2FF", borderColor: "#C7D2FE" },
  statusText: { fontWeight: "900", fontSize: 12 },
  statusTextPresent: { color: "#067647" },
  statusTextAbsent: { color: "#B42318" },
  statusTextLeave: { color: "#B54708" },
  statusTextSick: { color: "#4338CA" },

  emptyTitle: { fontSize: 16, fontWeight: "900", color: Colors.textPrimary },
});
