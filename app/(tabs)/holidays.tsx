// app/(tabs)/holidays.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import NepaliDate from "nepali-date-converter";
import { Ionicons } from "@expo/vector-icons";
import { CalendarPicker } from "react-native-nepali-picker";

import Screen from "../../src/components/Screen";
import AppHeader from "../../src/components/AppHeader";
import { Colors } from "../../src/constants/colors";
import { useTenant } from "../../src/tenant/TenantContext";
import {
  deleteHoliday,
  listHolidaysForMonth,
  upsertHoliday,
} from "../../src/db/holidaysRepo";

function currentMonthBs() {
  return new NepaliDate(new Date()).format("YYYY-MM");
}
function todayBs() {
  return new NepaliDate(new Date()).format("YYYY-MM-DD");
}

function bsToTime(dateBs: string) {
  return new NepaliDate(dateBs).toJsDate().getTime();
}

function getBsDatesInRange(startBs: string, endBs: string) {
  const start = new NepaliDate(startBs).toJsDate();
  const end = new NepaliDate(endBs).toJsDate();
  start.setHours(12, 0, 0, 0);
  end.setHours(12, 0, 0, 0);

  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    dates.push(new NepaliDate(new Date(cursor)).format("YYYY-MM-DD"));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

export default function HolidaysScreen() {
  const { tenant } = useTenant();

  const [monthBs, setMonthBs] = useState(currentMonthBs());
  const [dateBs, setDateBs] = useState(todayBs());
  const [endDateBs, setEndDateBs] = useState(todayBs());
  const [entryMode, setEntryMode] = useState<"single" | "range">("single");
  const [title, setTitle] = useState("");
  const [items, setItems] = useState<
    Array<{ dateBs: string; title?: string | null }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPurpose, setPickerPurpose] = useState<
    "holiday" | "end" | "month"
  >("holiday");

  const tenantId = tenant?.tenantId ?? "";

  async function refresh() {
    if (!tenantId) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const list = await listHolidaysForMonth({ tenantId, monthBs });
      setItems(list.map((h) => ({ dateBs: h.dateBs, title: h.title })));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, monthBs]);

  const editingHoliday = useMemo(
    () => items.find((holiday) => holiday.dateBs === editingDate),
    [editingDate, items],
  );

  if (!tenant) return null;

  function openNewHolidayForm() {
    const today = todayBs();
    setDateBs(today);
    setEndDateBs(today);
    setMonthBs(today.slice(0, 7));
    setEntryMode("single");
    setEditingDate(null);
    setTitle("");
    setFormOpen(true);
  }

  function editHoliday(holiday: { dateBs: string; title?: string | null }) {
    setDateBs(holiday.dateBs);
    setEndDateBs(holiday.dateBs);
    setMonthBs(holiday.dateBs.slice(0, 7));
    setEntryMode("single");
    setEditingDate(holiday.dateBs);
    setTitle(holiday.title ?? "");
    setFormOpen(true);
  }

  function openDatePicker(purpose: "holiday" | "end" | "month") {
    setPickerPurpose(purpose);
    setPickerOpen(true);
  }

  function onPickDate(picked: string) {
    setPickerOpen(false);

    if (pickerPurpose === "month") {
      setMonthBs(picked.slice(0, 7));
      return;
    }

    if (pickerPurpose === "end") {
      setEndDateBs(picked);
      return;
    }

    setDateBs(picked);
    setMonthBs(picked.slice(0, 7));
    if (entryMode === "range" && bsToTime(endDateBs) < bsToTime(picked)) {
      setEndDateBs(picked);
    }
    const existing = items.find((holiday) => holiday.dateBs === picked);
    setTitle(existing?.title ?? "");
    setEditingDate(entryMode === "single" && existing ? picked : null);
  }

  async function onSave() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateBs)) {
      Alert.alert(
        "Invalid date",
        "Use BS date format YYYY-MM-DD (e.g., 2082-08-15).",
      );
      return;
    }
    if (entryMode === "range" && !/^\d{4}-\d{2}-\d{2}$/.test(endDateBs)) {
      Alert.alert("Invalid end date", "Please select a valid ending BS date.");
      return;
    }

    try {
      const dates =
        entryMode === "range" ? getBsDatesInRange(dateBs, endDateBs) : [dateBs];

      if (dates.length === 0) {
        Alert.alert(
          "Invalid range",
          "The ending date must be on or after the starting date.",
        );
        return;
      }
      if (dates.length > 370) {
        Alert.alert(
          "Range too long",
          "Please select a vacation of 370 days or fewer.",
        );
        return;
      }

      for (const holidayDate of dates) {
        await upsertHoliday({
          tenantId,
          dateBs: holidayDate,
          title: title.trim() || undefined,
        });
      }
      setTitle("");
      await refresh();
      setFormOpen(false);
      Alert.alert(
        "Saved",
        dates.length === 1
          ? "Holiday added/updated."
          : `${dates.length} dates were marked as holiday.`,
      );
    } catch (e: any) {
      Alert.alert("Failed", e?.message ?? "Could not save holiday.");
    }
  }

  async function onDelete(d: string) {
    Alert.alert("Delete holiday?", d, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await deleteHoliday({ tenantId, dateBs: d });
          if (dateBs === d) setFormOpen(false);
          await refresh();
        },
      },
    ]);
  }

  return (
    <Screen>
      <AppHeader name={tenant.schoolName} address={tenant.schoolAddress} />

      <CalendarPicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onDateSelect={onPickDate}
        date={pickerPurpose === "end" ? endDateBs : dateBs}
        brandColor={Colors.primary}
      />

      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.pageHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.pageTitle}>Holidays</Text>
            <Text style={styles.muted}>
              Manage school holidays using Nepali dates.
            </Text>
          </View>
          <Pressable onPress={openNewHolidayForm} style={styles.addBtn}>
            <Ionicons name="add" size={18} color="#fff" />
            <Text style={styles.addBtnText}>Add Holiday</Text>
          </Pressable>
        </View>

        <Pressable
          onPress={() => openDatePicker("month")}
          style={styles.monthSelector}
        >
          <Ionicons name="calendar-outline" size={20} color={Colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.selectorLabel}>Viewing BS month</Text>
            <Text style={styles.selectorValue}>{monthBs}</Text>
          </View>
          <Text style={styles.changeText}>Change</Text>
        </Pressable>

        {formOpen ? (
          <View style={styles.card}>
            <View style={styles.formHeader}>
              <Text style={styles.cardTitle}>
                {editingHoliday ? "Update Holiday" : "Add Holiday"}
              </Text>
              <Pressable onPress={() => setFormOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color={Colors.textSecondary} />
              </Pressable>
            </View>

            {!editingHoliday ? (
              <View style={styles.modeSelector}>
                <Pressable
                  onPress={() => {
                    setEntryMode("single");
                    const existing = items.find(
                      (holiday) => holiday.dateBs === dateBs,
                    );
                    setEditingDate(existing ? dateBs : null);
                    if (existing) setTitle(existing.title ?? "");
                  }}
                  style={[
                    styles.modeBtn,
                    entryMode === "single" && styles.modeBtnActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.modeBtnText,
                      entryMode === "single" && styles.modeBtnTextActive,
                    ]}
                  >
                    Single Day
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setEntryMode("range");
                    setEditingDate(null);
                    if (bsToTime(endDateBs) < bsToTime(dateBs))
                      setEndDateBs(dateBs);
                  }}
                  style={[
                    styles.modeBtn,
                    entryMode === "range" && styles.modeBtnActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.modeBtnText,
                      entryMode === "range" && styles.modeBtnTextActive,
                    ]}
                  >
                    Date Range
                  </Text>
                </Pressable>
              </View>
            ) : null}

            <Text style={styles.label}>
              {entryMode === "range" ? "Starting date" : "Holiday date"}
            </Text>
            <Pressable
              onPress={() => openDatePicker("holiday")}
              style={styles.dateSelector}
            >
              <Ionicons name="calendar" size={19} color={Colors.primary} />
              <Text style={styles.dateText}>{dateBs}</Text>
              <Ionicons
                name="chevron-down"
                size={18}
                color={Colors.textSecondary}
              />
            </Pressable>

            {entryMode === "range" ? (
              <>
                <Text style={styles.label}>Ending date</Text>
                <Pressable
                  onPress={() => openDatePicker("end")}
                  style={styles.dateSelector}
                >
                  <Ionicons name="calendar" size={19} color={Colors.primary} />
                  <Text style={styles.dateText}>{endDateBs}</Text>
                  <Ionicons
                    name="chevron-down"
                    size={18}
                    color={Colors.textSecondary}
                  />
                </Pressable>
              </>
            ) : null}

            <Text style={styles.label}>Holiday name (optional)</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              style={styles.input}
              placeholder="e.g., Dashain Holiday"
              placeholderTextColor={Colors.textSecondary}
            />

            <Text style={styles.schoolWideNote}>
              {entryMode === "range"
                ? "Every date in this range will be marked as a holiday for all classes."
                : "This date will be marked as a holiday for all classes."}
            </Text>

            <Pressable onPress={onSave} style={styles.primaryBtn}>
              <Ionicons
                name="checkmark-circle-outline"
                size={19}
                color="#fff"
              />
              <Text style={styles.primaryText}>
                {editingHoliday
                  ? "Update Holiday"
                  : entryMode === "range"
                    ? "Mark Range as Holiday"
                    : "Mark as Holiday"}
              </Text>
            </Pressable>
          </View>
        ) : null}

        <Text style={[styles.cardTitle, { marginTop: 18 }]}>
          Holidays in {monthBs}
        </Text>
        {loading ? <Text style={styles.muted}>Loading...</Text> : null}

        {items.length === 0 && !loading ? (
          <Text style={styles.muted}>No holidays saved for this month.</Text>
        ) : (
          items.map((h) => (
            <Pressable
              key={h.dateBs}
              onPress={() => editHoliday(h)}
              style={styles.row}
            >
              <View style={styles.holidayIcon}>
                <Ionicons name="calendar" size={19} color="#B45309" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowDate}>{h.dateBs}</Text>
                <Text style={styles.rowTitle}>
                  {h.title || "School Holiday"}
                </Text>
              </View>
              <Pressable
                onPress={(event) => {
                  event.stopPropagation();
                  onDelete(h.dateBs);
                }}
                style={styles.deleteBtn}
              >
                <Ionicons name="trash-outline" size={18} color="#B42318" />
              </Pressable>
            </Pressable>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 32 },
  pageHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  pageTitle: { fontSize: 22, fontWeight: "800", color: Colors.textPrimary },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: Colors.primary,
  },
  addBtnText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  monthSelector: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 13,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    backgroundColor: Colors.surface,
  },
  selectorLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.textSecondary,
  },
  selectorValue: {
    marginTop: 2,
    fontSize: 16,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  changeText: { color: Colors.primary, fontSize: 12, fontWeight: "800" },
  card: {
    borderWidth: 1,
    borderColor: "#FCD34D",
    borderRadius: 16,
    padding: 14,
    marginTop: 14,
    backgroundColor: "#FFFBEB",
  },
  formHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modeSelector: {
    flexDirection: "row",
    padding: 4,
    marginTop: 6,
    borderRadius: 12,
    backgroundColor: "#FEF3C7",
  },
  modeBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 9,
    borderRadius: 9,
  },
  modeBtnActive: { backgroundColor: Colors.surface },
  modeBtnText: { fontSize: 12, fontWeight: "800", color: "#92400E" },
  modeBtnTextActive: { color: Colors.primary },
  cardTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  label: { marginTop: 10, marginBottom: 6, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: Colors.surface,
    color: Colors.textPrimary,
  },
  dateSelector: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    backgroundColor: Colors.surface,
  },
  dateText: {
    flex: 1,
    fontSize: 15,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  schoolWideNote: {
    marginTop: 10,
    fontSize: 12,
    color: "#92400E",
    lineHeight: 17,
  },
  primaryBtn: {
    marginTop: 12,
    flexDirection: "row",
    justifyContent: "center",
    gap: 7,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: Colors.primary,
  },
  primaryText: { fontWeight: "800", color: "#fff" },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    borderWidth: 1,
    borderColor: "#FDE68A",
    borderRadius: 14,
    padding: 12,
    marginTop: 10,
    backgroundColor: "#FFFBEB",
  },
  holidayIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FEF3C7",
  },
  rowDate: { fontWeight: "800", color: "#92400E" },
  rowTitle: { marginTop: 3, color: Colors.textPrimary },
  muted: { color: Colors.textSecondary, marginTop: 6 },
  deleteBtn: {
    padding: 9,
    borderWidth: 1,
    borderColor: "#FECACA",
    borderRadius: 10,
    backgroundColor: "#FEF2F2",
  },
});
