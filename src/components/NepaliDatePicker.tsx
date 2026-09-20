import { Ionicons } from "@expo/vector-icons";
import NepaliDate from "nepali-date-converter";
import React, { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const MONTHS = [
  "बैशाख", "जेठ", "असार", "श्रावण", "भदौ", "आश्विन",
  "कार्तिक", "मंसिर", "पुष", "माघ", "फाल्गुन", "चैत्र",
];
const WEEKDAYS = ["आइत", "सोम", "मंगल", "बुध", "बिहि", "शुक्र", "शनि"];
const NP_DIGITS = ["०", "१", "२", "३", "४", "५", "६", "७", "८", "९"];

type Props = {
  visible: boolean;
  date: string;
  onClose: () => void;
  onDateSelect: (date: string) => void;
  minDate?: string;
  maxDate?: string;
  brandColor?: string;
};

const pad = (value: number) => String(value).padStart(2, "0");
const formatBs = (year: number, month: number, day: number) =>
  `${year}-${pad(month + 1)}-${pad(day)}`;
const toNepaliDigits = (value: string | number) =>
  String(value).replace(/\d/g, (digit) => NP_DIGITS[Number(digit)]);

function parseBs(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month: month - 1, day };
}

function daysInBsMonth(year: number, month: number) {
  for (let day = 32; day >= 29; day -= 1) {
    try {
      const candidate = new NepaliDate(year, month, day);
      if (candidate.getYear() === year && candidate.getMonth() === month) return day;
    } catch {
      // Try the next smaller day.
    }
  }
  return 29;
}

export default function NepaliDatePicker({
  visible,
  date,
  onClose,
  onDateSelect,
  minDate,
  maxDate,
  brandColor = "#1746A2",
}: Props) {
  const selected = useMemo(() => parseBs(date), [date]);
  const [viewYear, setViewYear] = useState(selected.year);
  const [viewMonth, setViewMonth] = useState(selected.month);

  useEffect(() => {
    if (visible) {
      setViewYear(selected.year);
      setViewMonth(selected.month);
    }
  }, [visible, selected.month, selected.year]);

  const monthLength = useMemo(
    () => daysInBsMonth(viewYear, viewMonth),
    [viewMonth, viewYear],
  );
  const firstWeekday = useMemo(
    () => new NepaliDate(formatBs(viewYear, viewMonth, 1)).toJsDate().getDay(),
    [viewMonth, viewYear],
  );
  const today = new NepaliDate().format("YYYY-MM-DD");
  const cells = Array.from({ length: 42 }, (_, index) => {
    const day = index - firstWeekday + 1;
    return day >= 1 && day <= monthLength ? day : null;
  });

  const changeMonth = (delta: number) => {
    const raw = viewMonth + delta;
    if (raw < 0) {
      if (viewYear <= 2000) return;
      setViewYear((year) => year - 1);
      setViewMonth(11);
    } else if (raw > 11) {
      if (viewYear >= 2090) return;
      setViewYear((year) => year + 1);
      setViewMonth(0);
    } else {
      setViewMonth(raw);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <SafeAreaView style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.card}>
          <View style={[styles.hero, { backgroundColor: brandColor }]}>
            <View>
              <Text style={styles.heroLabel}>मिति छान्नुहोस्</Text>
              <Text style={styles.heroDate}>
                {toNepaliDigits(date)}
              </Text>
            </View>
            <Ionicons name="calendar" size={30} color="#FFFFFF" />
          </View>

          <View style={styles.monthBar}>
            <Pressable
              accessibilityLabel="अघिल्लो महिना"
              hitSlop={10}
              onPress={() => changeMonth(-1)}
              style={styles.arrowButton}
            >
              <Ionicons name="chevron-back" size={24} color={brandColor} />
            </Pressable>
            <Text style={[styles.monthTitle, { color: brandColor }]}>
              {MONTHS[viewMonth]} {toNepaliDigits(viewYear)}
            </Text>
            <Pressable
              accessibilityLabel="अर्को महिना"
              hitSlop={10}
              onPress={() => changeMonth(1)}
              style={styles.arrowButton}
            >
              <Ionicons name="chevron-forward" size={24} color={brandColor} />
            </Pressable>
          </View>

          <View style={styles.grid}>
            {WEEKDAYS.map((label, index) => (
              <View key={label} style={styles.cell}>
                <Text style={[styles.weekday, index === 6 && styles.saturdayText]}>
                  {label}
                </Text>
              </View>
            ))}
            {cells.map((day, index) => {
              if (!day) return <View key={`empty-${index}`} style={styles.cell} />;
              const value = formatBs(viewYear, viewMonth, day);
              const isSelected = value === date;
              const isToday = value === today;
              const isSaturday = index % 7 === 6;
              const disabled = (!!minDate && value < minDate) || (!!maxDate && value > maxDate);

              return (
                <View key={value} style={styles.cell}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={value}
                    accessibilityState={{ disabled, selected: isSelected }}
                    disabled={disabled}
                    onPress={() => onDateSelect(value)}
                    style={({ pressed }) => [
                      styles.day,
                      isToday && !isSelected && { borderColor: "#F59E0B", borderWidth: 2 },
                      isSelected && { backgroundColor: brandColor },
                      pressed && !disabled && styles.pressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayText,
                        isSaturday && styles.saturdayText,
                        disabled && styles.disabledText,
                        isSelected && styles.selectedText,
                      ]}
                    >
                      {toNepaliDigits(day)}
                    </Text>
                    {isToday && !isSelected ? <View style={styles.todayDot} /> : null}
                  </Pressable>
                </View>
              );
            })}
          </View>

          <View style={styles.footer}>
            <View style={styles.todayLegend}>
              <View style={styles.legendDot} />
              <Text style={styles.legendText}>आज</Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeButton}>
              <Text style={[styles.closeText, { color: brandColor }]}>रद्द गर्नुहोस्</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
  },
  card: {
    width: "100%",
    maxWidth: 410,
    overflow: "hidden",
    borderRadius: 24,
    backgroundColor: "#FFFFFF",
    elevation: 12,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 18,
  },
  hero: {
    minHeight: 100,
    paddingHorizontal: 22,
    paddingVertical: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  heroLabel: { color: "#DBEAFE", fontSize: 13, fontWeight: "700" },
  heroDate: { marginTop: 6, color: "#FFFFFF", fontSize: 25, fontWeight: "800" },
  monthBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 8,
  },
  arrowButton: { width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  monthTitle: { fontSize: 18, fontWeight: "800" },
  grid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 12 },
  cell: { width: "14.2857%", height: 46, alignItems: "center", justifyContent: "center" },
  weekday: { color: "#64748B", fontSize: 12, fontWeight: "800" },
  day: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  dayText: { color: "#1E293B", fontSize: 15, fontWeight: "700" },
  saturdayText: { color: "#DC2626" },
  selectedText: { color: "#FFFFFF" },
  disabledText: { color: "#CBD5E1" },
  pressed: { opacity: 0.65, transform: [{ scale: 0.94 }] },
  todayDot: { position: "absolute", bottom: 3, width: 4, height: 4, borderRadius: 2, backgroundColor: "#F59E0B" },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#E2E8F0",
  },
  todayLegend: { flexDirection: "row", alignItems: "center", gap: 7 },
  legendDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#F59E0B" },
  legendText: { color: "#64748B", fontSize: 13, fontWeight: "600" },
  closeButton: { paddingHorizontal: 8, paddingVertical: 6 },
  closeText: { fontSize: 14, fontWeight: "800" },
});
