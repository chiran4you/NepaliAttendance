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
  ScrollView,
} from "react-native";
import NepaliDate from "nepali-date-converter";
import { Ionicons } from "@expo/vector-icons";
import { CalendarPicker } from "react-native-nepali-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as Print from "expo-print";
import { Buffer } from "buffer";
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
  getStudentMonthDetails,
  type MonthlyStudentSummary,
  type StudentMonthDetails,
} from "../../src/db/reportRepo";

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

const BS_MONTH_NAMES = [
  "Baisakh",
  "Jestha",
  "Ashadh",
  "Shrawan",
  "Bhadra",
  "Ashwin",
  "Kartik",
  "Mangsir",
  "Poush",
  "Magh",
  "Falgun",
  "Chaitra",
] as const;

function formatReportMonthBs(monthBs: string): string {
  const [year, month] = monthBs.split("-");
  const monthName = BS_MONTH_NAMES[Number(month) - 1];
  return monthName && year
    ? `${monthName} ${year} (B.S.)`
    : `${monthBs} (B.S.)`;
}

function formatClassWithSection(classItem: ClassItem): string {
  const name = String(classItem.name ?? "").trim();
  const section = String(
    (classItem as ClassItem & { section?: string }).section ?? "",
  ).trim();
  const classWithSection =
    section && !name.toLowerCase().endsWith(section.toLowerCase())
      ? `${name}${section}`
      : name;

  return /^grade\b/i.test(classWithSection)
    ? classWithSection.replace(/^grade\s*[-:]?\s*/i, "Grade - ")
    : `Grade - ${classWithSection}`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

      const lastVerifiedAtRaw =
        obj?.lastVerifiedAt ?? obj?.lastVerified ?? null;
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
        lastVerifiedAt: Number.isFinite(lastVerifiedAt as any)
          ? (lastVerifiedAt as any)
          : null,
        graceUntil: Number.isFinite(graceUntil as any)
          ? (graceUntil as any)
          : null,
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
  const [detailStudent, setDetailStudent] =
    useState<MonthlyStudentSummary | null>(null);
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
      if (classId && !list.some((c) => c.id === classId))
        setClassId(list[0]?.id ?? null);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to load classes");
    }
  }, [tenantId, classId]);

  // ✅ FIX: refresh classes + report every time Reports tab is focused
  useFocusEffect(
    useCallback(() => {
      refreshClasses();
      setRefreshTick((t) => t + 1);
    }, [refreshClasses]),
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
    [classes, classId],
  );

  const totals = useMemo(() => {
    const totalDays =
      rows.length > 0 ? Math.max(...rows.map((r) => r.total)) : 0;
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
          totalSessions: 0,
        };
      }

      return getStudentMonthDetails({
        tenantId,
        classId,
        studentId,
        monthBs,
      });
    },
    [tenantId, classId, monthBs],
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
    [loadStudentMonthDetails],
  );
  const EXPORT_DIR_KEY = "ATTENDANCE_EXPORT_DIR_URI";

  async function saveExportToDownloads(
    fileName: string,
    base64: string,
    mimeType: string,
  ) {
    // Android: use Storage Access Framework so user chooses folder once
    if (Platform.OS === "android" && FileSystem.StorageAccessFramework) {
      const cached = await AsyncStorage.getItem(EXPORT_DIR_KEY);

      const writeToDir = async (dirUri: string) => {
        const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
          dirUri,
          fileName,
          mimeType,
        );
        await FileSystem.writeAsStringAsync(fileUri, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });

        // Optional share copy
        try {
          if (Sharing && (await Sharing.isAvailableAsync())) {
            const shareUri = `${FileSystem.cacheDirectory}${fileName}`;
            await FileSystem.writeAsStringAsync(shareUri, base64, {
              encoding: FileSystem.EncodingType.Base64,
            });
            await Sharing.shareAsync(shareUri, { mimeType });
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
    await FileSystem.writeAsStringAsync(uri, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    if (Sharing && (await Sharing.isAvailableAsync())) {
      await Sharing.shareAsync(uri, { mimeType });
    } else {
      Alert.alert("Saved", `Saved to: ${uri}`);
    }
  }

  async function exportExcel() {
    if (!tenantId || !selectedClass) return;

    if (!csvAllowedForSchool) {
      Alert.alert(
        "Export not available",
        "Excel export is disabled for this school.",
      );
      return;
    }

    if (!premiumOk) {
      Alert.alert(
        "Premium required",
        "Excel export is a premium feature. Activate Premium in Settings.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Go to Settings",
            onPress: () => router.push("/(tabs)/settings"),
          },
        ],
      );
      return;
    }

    // Match the sample export:
    // - No missing days (all dates in the BS month are present)
    // - Saturdays show "Saturday"
    // - Holidays show the holiday title (entered by the class teacher)
    // - Attendance Percentage is stored as a numeric Excel percentage

    try {
      const { buildMonthlyMatrix, dateColLabel } =
        await import("../../src/db/reportRepo");

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

      // ExcelJS/JSZip expects Buffer in the global scope. Expo Go does not
      // provide it, so install the lightweight browser polyfill before loading.
      (globalThis as typeof globalThis & { Buffer?: typeof Buffer }).Buffer ??=
        Buffer;
      const { default: ExcelJS } = await import("exceljs");
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Nepali Attendance";
      workbook.created = new Date();
      const worksheet = workbook.addWorksheet("Attendance Report", {
        views: [{ state: "frozen", xSplit: 2, ySplit: 6 }],
        pageSetup: {
          orientation: "landscape",
          fitToPage: true,
          fitToWidth: 1,
          fitToHeight: 0,
        },
      });

      const lastColumn = header.length;
      const titleRows = [
        tenant.schoolName,
        tenant.schoolAddress,
        `MONTHLY ATTENDANCE REPORT — ${formatReportMonthBs(monthBs).toUpperCase()}`,
        formatClassWithSection(selectedClass),
      ];

      titleRows.forEach((title, index) => {
        const rowNumber = index + 1;
        worksheet.mergeCells(rowNumber, 1, rowNumber, lastColumn);
        const cell = worksheet.getCell(rowNumber, 1);
        cell.value = title;
        cell.alignment = { horizontal: "center", vertical: "middle" };
      });

      worksheet.getRow(1).height = 27;
      worksheet.getCell("A1").font = {
        name: "Calibri",
        size: 16,
        bold: true,
        color: { argb: "FF17365D" },
      };
      worksheet.getRow(2).height = 21;
      worksheet.getCell("A2").font = {
        name: "Calibri",
        size: 11,
        color: { argb: "FF666666" },
      };
      worksheet.getRow(3).height = 25;
      worksheet.getCell("A3").font = {
        name: "Calibri",
        size: 14,
        bold: true,
        color: { argb: "FF17365D" },
      };
      worksheet.getRow(4).height = 22;
      worksheet.getCell("A4").font = {
        name: "Calibri",
        size: 11,
        bold: true,
        color: { argb: "FF1F1F1F" },
      };
      worksheet.getRow(5).height = 9;

      const headerRow = worksheet.getRow(6);
      headerRow.values = header;
      headerRow.height = 32;
      headerRow.eachCell((cell) => {
        cell.font = {
          name: "Calibri",
          size: 10,
          bold: true,
          color: { argb: "FFFFFFFF" },
        };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF17365D" },
        };
        cell.alignment = {
          horizontal: "center",
          vertical: "middle",
          wrapText: true,
        };
        cell.border = {
          top: { style: "thin", color: { argb: "FFB4C6E7" } },
          left: { style: "thin", color: { argb: "FFB4C6E7" } },
          bottom: { style: "thin", color: { argb: "FFB4C6E7" } },
          right: { style: "thin", color: { argb: "FFB4C6E7" } },
        };
      });

      const classesHeld = sessions.filter(
        (s: any) => (s?.dayType ?? "CLASS") === "CLASS",
      ).length;

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
          if (
            status === "A" ||
            status === "P" ||
            status === "L" ||
            status === "S"
          ) {
            cells.push(status);
          } else {
            cells.push("");
          }
        }

        const pct = classesHeld ? attended / classesHeld : 0;
        const row = worksheet.addRow([
          st.rollNo,
          st.name,
          classesHeld,
          attended,
          pct,
          ...cells,
        ]);
        row.height = 21;
        row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
          cell.font = {
            name: "Calibri",
            size: 10,
            color: { argb: "FF1F1F1F" },
          };
          cell.alignment = {
            horizontal: columnNumber === 2 ? "left" : "center",
            vertical: "middle",
            wrapText: columnNumber >= 6,
          };
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: row.number % 2 === 0 ? "FFF2F6FC" : "FFFFFFFF" },
          };
          cell.border = {
            top: { style: "thin", color: { argb: "FFD9E2F3" } },
            left: { style: "thin", color: { argb: "FFD9E2F3" } },
            bottom: { style: "thin", color: { argb: "FFD9E2F3" } },
            right: { style: "thin", color: { argb: "FFD9E2F3" } },
          };
        });
        row.getCell(5).numFmt = "0.0%";

        cells.forEach((status, index) => {
          const cell = row.getCell(index + 6);
          const normalized = status.toUpperCase();
          const dayType = sessions[index]?.dayType;
          const color =
            normalized === "P"
              ? "FFE2F0D9"
              : normalized === "A"
                ? "FFFCE4D6"
                : normalized === "L"
                  ? "FFFFF2CC"
                  : normalized === "S"
                    ? "FFDDEBF7"
                    : dayType === "WEEKLY_OFF" || dayType === "HOLIDAY"
                      ? "FFE7E6E6"
                      : null;

          if (color) {
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: color },
            };
          }
          if (normalized === "A") {
            cell.font = {
              name: "Calibri",
              size: 10,
              bold: true,
              color: { argb: "FFC00000" },
            };
          } else if (normalized === "P") {
            cell.font = {
              name: "Calibri",
              size: 10,
              bold: true,
              color: { argb: "FF375623" },
            };
          }
        });
      }

      worksheet.getColumn(1).width = 10;
      worksheet.getColumn(2).width = 28;
      worksheet.getColumn(3).width = 13;
      worksheet.getColumn(4).width = 15;
      worksheet.getColumn(5).width = 16;
      for (let column = 6; column <= lastColumn; column += 1) {
        worksheet.getColumn(column).width = 13;
      }
      worksheet.autoFilter = {
        from: { row: 6, column: 1 },
        to: { row: 6, column: lastColumn },
      };

      const className = formatClassWithSection(selectedClass).replace(
        /[^a-z0-9_-]+/gi,
        "_",
      );
      const fileName = `🏫${className}_Attendance_Report_${monthBs}.xlsx`;
      const bytes = await workbook.xlsx.writeBuffer();
      const base64 = Buffer.from(bytes as ArrayBuffer).toString("base64");

      await saveExportToDownloads(
        fileName,
        base64,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      Alert.alert("Exported", `Saved: ${fileName}`);
    } catch (e: any) {
      Alert.alert(
        "Export failed",
        e?.message ?? "Could not export Excel report.",
      );
    }
  }

  async function exportPdf() {
    if (!tenantId || !selectedClass) return;

    if (!csvAllowedForSchool) {
      Alert.alert(
        "Export not available",
        "Report export is disabled for this school.",
      );
      return;
    }

    if (!premiumOk) {
      Alert.alert(
        "Premium required",
        "PDF export is a premium feature. Activate Premium in Settings.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Go to Settings",
            onPress: () => router.push("/(tabs)/settings"),
          },
        ],
      );
      return;
    }

    if (rows.length === 0) {
      Alert.alert(
        "Nothing to export",
        "No attendance data found for this class.",
      );
      return;
    }

    try {
      const classLabel = formatClassWithSection(selectedClass);
      const tableRows = rows
        .map(
          (student, index) => `
            <tr>
              <td class="center">${escapeHtml(student.rollNo)}</td>
              <td>${escapeHtml(student.name)}</td>
              <td class="center present">${escapeHtml(student.present)}</td>
              <td class="center absent">${escapeHtml(student.absent)}</td>
              <td class="center leave">${escapeHtml(student.leave)}</td>
              <td class="center sick">${escapeHtml(student.sick)}</td>
              <td class="center">${escapeHtml(student.total)}</td>
              <td class="center rate">${escapeHtml(student.percentage)}%</td>
            </tr>`,
        )
        .join("");

      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8" />
            <style>
              @page { size: A4 landscape; margin: 14mm 12mm; }
              * { box-sizing: border-box; }
              body { font-family: Arial, sans-serif; color: #1f2937; margin: 0; font-size: 10px; }
              .school { text-align: center; color: #17365d; font-size: 20px; font-weight: 800; margin: 0; }
              .address { text-align: center; color: #64748b; font-size: 11px; margin-top: 4px; }
              .report-title { text-align: center; color: #17365d; font-size: 15px; font-weight: 800; margin-top: 12px; }
              .report-meta { text-align: center; font-size: 11px; font-weight: 700; margin-top: 4px; }
              .summary { display: flex; gap: 8px; margin: 14px 0 12px; }
              .summary-box { flex: 1; border: 1px solid #d9e2f3; border-radius: 7px; padding: 8px; text-align: center; background: #f8fafc; }
              .summary-value { font-size: 16px; font-weight: 800; color: #17365d; }
              .summary-label { margin-top: 2px; color: #64748b; font-size: 9px; font-weight: 700; }
              table { width: 100%; border-collapse: collapse; page-break-inside: auto; }
              thead { display: table-header-group; }
              tr { page-break-inside: avoid; }
              th { background: #17365d; color: white; padding: 7px 5px; border: 1px solid #b4c6e7; font-size: 9px; }
              td { padding: 6px 5px; border: 1px solid #d9e2f3; }
              tbody tr:nth-child(even) { background: #f2f6fc; }
              .center { text-align: center; }
              .present { color: #2563eb; font-weight: 800; }
              .absent { color: #dc2626; font-weight: 800; }
              .leave { color: #b45309; font-weight: 800; }
              .sick { color: #4338ca; font-weight: 800; }
              .rate { color: #17365d; font-weight: 800; }
              .legend { margin-top: 9px; color: #64748b; font-size: 9px; }
              .footer { margin-top: 10px; text-align: right; color: #94a3b8; font-size: 8px; }
            </style>
          </head>
          <body>
            <h1 class="school">${escapeHtml(tenant.schoolName)}</h1>
            <div class="address">${escapeHtml(tenant.schoolAddress)}</div>
            <div class="report-title">MONTHLY ATTENDANCE REPORT</div>
            <div class="report-meta">${escapeHtml(formatReportMonthBs(monthBs))} | ${escapeHtml(classLabel)}</div>

            <div class="summary">
              <div class="summary-box"><div class="summary-value">${rows.length}</div><div class="summary-label">Students</div></div>
              <div class="summary-box"><div class="summary-value">${totals.totalDays}</div><div class="summary-label">Classes Held</div></div>
              <div class="summary-box"><div class="summary-value">${sumPresent}</div><div class="summary-label">Total Present</div></div>
              <div class="summary-box"><div class="summary-value">${sumAbsent + rows.reduce((sum, row) => sum + row.leave + row.sick, 0)}</div><div class="summary-label">Total Not Present</div></div>
              <div class="summary-box"><div class="summary-value">${overallRate}%</div><div class="summary-label">Attendance Rate</div></div>
            </div>

            <table>
              <thead>
                <tr>
                  <th>Roll</th><th>Student Name</th><th>Present</th><th>Absent</th>
                  <th>Leave</th><th>Sick</th><th>Classes Held</th><th>Attendance</th>
                </tr>
              </thead>
              <tbody>${tableRows}</tbody>
            </table>
            <div class="legend">Absent, Leave and Sick are shown separately. Attendance percentage is based on Present / Classes Held.</div>
            <div class="footer">Generated by Nepali Attendance</div>
          </body>
        </html>`;

      const pdf = await Print.printToFileAsync({ html, base64: true });
      if (!pdf.base64) throw new Error("PDF data could not be generated.");

      const className = classLabel.replace(/[^a-z0-9_-]+/gi, "_");
      const fileName = `${className}_Attendance_Report_${monthBs}.pdf`;
      await saveExportToDownloads(fileName, pdf.base64, "application/pdf");
      Alert.alert("Exported", `Saved: ${fileName}`);
    } catch (e: any) {
      Alert.alert(
        "Export failed",
        e?.message ?? "Could not export PDF report.",
      );
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
        <Modal
          visible={detailOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setDetailOpen(false)}
        >
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setDetailOpen(false)}
          >
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
                <Pressable
                  onPress={() => setDetailOpen(false)}
                  style={styles.detailCloseBtn}
                >
                  <Ionicons name="close" size={20} color={Colors.textPrimary} />
                </Pressable>
              </View>

              {detailLoading ? (
                <Text style={styles.detailLoading}>Loading…</Text>
              ) : !detailStudent || !detail ? (
                <Text style={styles.detailLoading}>No details</Text>
              ) : (
                <ScrollView contentContainerStyle={{ gap: 12 }}>
                  <View style={styles.detailBadges}>
                    <View style={styles.detailBadge}>
                      <Text style={styles.detailBadgeValue}>
                        {detail.presentDates.length}
                      </Text>
                      <Text style={styles.detailBadgeLabel}>Present</Text>
                    </View>
                    <View style={styles.detailBadge}>
                      <Text style={styles.detailBadgeValue}>
                        {detail.absentDates.length}
                      </Text>
                      <Text style={styles.detailBadgeLabel}>Absent</Text>
                    </View>
                    <View style={styles.detailBadge}>
                      <Text style={styles.detailBadgeValue}>
                        {detail.leaveDates.length}
                      </Text>
                      <Text style={styles.detailBadgeLabel}>Leave</Text>
                    </View>
                    <View style={styles.detailBadge}>
                      <Text style={styles.detailBadgeValue}>
                        {detail.sickDates.length}
                      </Text>
                      <Text style={styles.detailBadgeLabel}>Sick</Text>
                    </View>
                  </View>

                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionTitle}>Present dates</Text>
                    <Text style={styles.detailDates}>
                      {detail.presentDates.length
                        ? detail.presentDates.join(", ")
                        : "-"}
                    </Text>
                  </View>

                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionTitle}>Absent dates</Text>
                    <Text style={styles.detailDates}>
                      {detail.absentDates.length
                        ? detail.absentDates.join(", ")
                        : "-"}
                    </Text>
                  </View>

                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionTitle}>Leave dates</Text>
                    <Text style={styles.detailDates}>
                      {detail.leaveDates.length
                        ? detail.leaveDates.join(", ")
                        : "-"}
                    </Text>
                  </View>

                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionTitle}>Sick dates</Text>
                    <Text style={styles.detailDates}>
                      {detail.sickDates.length
                        ? detail.sickDates.join(", ")
                        : "-"}
                    </Text>
                  </View>
                </ScrollView>
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
            </View>

            <View style={styles.exportActions}>
              <Pressable
                onPress={exportExcel}
                style={[
                  styles.exportBtn,
                  premiumOk && csvAllowedForSchool
                    ? styles.exportBtnActive
                    : styles.exportBtnLocked,
                ]}
              >
                <Ionicons
                  name={
                    premiumOk && csvAllowedForSchool
                      ? "download-outline"
                      : "lock-closed-outline"
                  }
                  size={18}
                  color={
                    premiumOk && csvAllowedForSchool
                      ? "#FFFFFF"
                      : Colors.textSecondary
                  }
                />
                <Text
                  style={[
                    styles.exportText,
                    premiumOk
                      ? { color: "#FFFFFF" }
                      : { color: Colors.textSecondary },
                  ]}
                >
                  {premiumOk && csvAllowedForSchool
                    ? "Export Excel"
                    : "Export Locked"}
                </Text>
              </Pressable>

              <Pressable
                onPress={exportPdf}
                style={[
                  styles.exportBtn,
                  premiumOk && csvAllowedForSchool
                    ? styles.exportPdfBtnActive
                    : styles.exportBtnLocked,
                ]}
              >
                <Ionicons
                  name={
                    premiumOk && csvAllowedForSchool
                      ? "document-text-outline"
                      : "lock-closed-outline"
                  }
                  size={18}
                  color={
                    premiumOk && csvAllowedForSchool
                      ? "#FFFFFF"
                      : Colors.textSecondary
                  }
                />
                <Text
                  style={[
                    styles.exportText,
                    premiumOk && csvAllowedForSchool
                      ? { color: "#FFFFFF" }
                      : { color: Colors.textSecondary },
                  ]}
                >
                  {premiumOk && csvAllowedForSchool
                    ? "Export PDF"
                    : "PDF Locked"}
                </Text>
              </Pressable>
            </View>

            {!csvAllowedForSchool ? (
              <Text style={styles.exportHint}>
                Report export is disabled for this school.
              </Text>
            ) : null}

            <View style={styles.controls}>
              <Pressable
                style={styles.pickerBtn}
                onPress={() => setPickerOpen(true)}
              >
                <Ionicons
                  name="calendar-outline"
                  size={18}
                  color={Colors.textPrimary}
                />
                <Text style={styles.pickerText}>{monthBs}</Text>
              </Pressable>

              {classes.length === 0 ? (
                <View style={styles.emptyMini}>
                  <Ionicons
                    name="school-outline"
                    size={18}
                    color={Colors.textSecondary}
                  />
                  <Text style={styles.emptyMiniText}>
                    No classes yet. Add classes first.
                  </Text>
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
                        <Text
                          style={[
                            styles.chipText,
                            active && styles.chipTextActive,
                          ]}
                        >
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
                          selectedClass.section
                            ? ` (${selectedClass.section})`
                            : ""
                        }`
                      : "Class"}
                  </Text>
                  <Text style={styles.summarySub}>
                    Month (BS):{" "}
                    <Text
                      style={{ fontWeight: "900", color: Colors.textPrimary }}
                    >
                      {monthBs}
                    </Text>
                  </Text>
                </View>

                <View style={styles.summaryPill}>
                  <Ionicons
                    name="stats-chart-outline"
                    size={16}
                    color={Colors.primary}
                  />
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
                  <View
                    style={[styles.progressFill, { width: `${overallRate}%` }]}
                  />
                </View>
                <Text style={styles.summaryFooterText}>
                  Overall attendance rate for this month (based on all students)
                </Text>
              </View>
            </View>

            <Text style={styles.listTitle}>Students</Text>
            <Text style={styles.listSub}>
              Swipe anywhere to scroll • Tap a card to view details later
            </Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons
              name="document-text-outline"
              size={28}
              color={Colors.textSecondary}
            />
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
            <View
              style={styles.progressWrap}
              accessibilityLabel="Attendance progress"
            >
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${Math.min(100, Math.max(0, item.percentage))}%`,
                    },
                  ]}
                />
              </View>
              <Text style={styles.progressHint}>
                {item.present} present • {item.absent} absent • {item.total}{" "}
                days
              </Text>
            </View>

            <View style={styles.cardStats}>
              <View style={[styles.stat, styles.statPresent]}>
                <Text style={[styles.statValue, styles.statValuePresent]}>
                  {item.present}
                </Text>
                <Text style={[styles.statLabel, styles.statLabelPresent]}>
                  Present
                </Text>
              </View>

              <View style={[styles.stat, styles.statAbsent]}>
                <Text style={[styles.statValue, styles.statValueAbsent]}>
                  {item.absent}
                </Text>
                <Text style={[styles.statLabel, styles.statLabelAbsent]}>
                  Absent
                </Text>
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

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 10,
  },
  title: { fontSize: 20, fontWeight: "900", color: Colors.textPrimary },
  subtitle: { fontSize: 12, color: Colors.textSecondary, marginTop: 3 },

  exportActions: { flexDirection: "row", gap: 10, marginBottom: 10 },
  exportBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: "center",
  },
  exportBtnActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  exportPdfBtnActive: { backgroundColor: "#DC2626", borderColor: "#DC2626" },
  exportBtnLocked: { backgroundColor: "#FFFFFF", borderColor: Colors.border },
  exportText: { fontWeight: "900", fontSize: 12 },
  exportHint: {
    marginTop: 6,
    marginBottom: 6,
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 16,
  },

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

  emptyMini: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 4,
  },
  emptyMiniText: {
    color: Colors.textSecondary,
    fontWeight: "800",
    fontSize: 12,
  },

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
  listTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  listSub: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: "800",
    marginBottom: 10,
  },
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
  badgeLabel: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "800",
    color: Colors.textSecondary,
  },

  card: {
    marginHorizontal: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: "#FFFFFF",
    padding: 12,
    marginBottom: 10,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  cardName: { fontSize: 14, fontWeight: "900", color: Colors.textPrimary },
  cardMeta: {
    marginTop: 3,
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: "800",
  },

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
  progressHint: {
    fontSize: 11,
    fontWeight: "800",
    color: Colors.textSecondary,
  },

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
    maxHeight: "86%",
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10,
  },
  detailHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  detailTitle: { fontSize: 16, fontWeight: "900", color: Colors.textPrimary },
  detailSub: {
    marginTop: 3,
    fontSize: 12,
    fontWeight: "800",
    color: Colors.textSecondary,
  },
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
  detailLoading: {
    fontSize: 12,
    fontWeight: "800",
    color: Colors.textSecondary,
    paddingVertical: 10,
  },
  detailBadges: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  detailBadge: {
    width: "47%",
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
  detailBadgeValue: {
    fontWeight: "900",
    color: Colors.textPrimary,
    fontSize: 14,
  },
  detailBadgeLabel: {
    marginTop: 2,
    fontWeight: "800",
    color: Colors.textSecondary,
    fontSize: 11,
  },
  detailSection: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    padding: 12,
    gap: 6,
  },
  detailSectionTitle: {
    fontWeight: "900",
    color: Colors.textPrimary,
    fontSize: 12,
  },
  detailDates: {
    color: Colors.textSecondary,
    fontWeight: "800",
    fontSize: 12,
    lineHeight: 18,
  },

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
  summarySub: {
    marginTop: 3,
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: "800",
  },
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
  summaryLabel: {
    marginTop: 2,
    fontWeight: "800",
    color: Colors.textSecondary,
    fontSize: 11,
  },

  summaryFooter: { gap: 6 },
  summaryFooterText: {
    fontSize: 11,
    fontWeight: "800",
    color: Colors.textSecondary,
  },
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
  statLabel: {
    marginTop: 2,
    fontWeight: "800",
    color: Colors.textSecondary,
    fontSize: 11,
  },

  empty: {
    alignItems: "center",
    paddingVertical: 36,
    gap: 8,
    marginHorizontal: 16,
  },
  emptyTitle: { fontSize: 16, fontWeight: "900", color: Colors.textPrimary },
  emptySubtitle: {
    textAlign: "center",
    color: Colors.textSecondary,
    marginTop: 2,
  },
});
