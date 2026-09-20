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
import AsyncStorage from "@react-native-async-storage/async-storage";
import { File, Paths } from "expo-file-system";
import * as LegacyFileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as Print from "expo-print";
import { Buffer } from "buffer";
import { useRouter } from "expo-router";
import { useFocusEffect } from "expo-router/react-navigation";

import Screen from "../../src/components/Screen";
import AppHeader from "../../src/components/AppHeader";
import NepaliDatePicker from "../../src/components/NepaliDatePicker";
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

type ReportMode = "monthly" | "academic";

function academicMonthsForYear(yearBs: string): string[] {
  const currentMonth = monthFromBsDate(todayBs());
  return Array.from({ length: 12 }, (_, index) => {
    const month = String(index + 1).padStart(2, "0");
    return `${yearBs}-${month}`;
  }).filter((month) => month <= currentMonth);
}

function formatAcademicYearBs(yearBs: string): string {
  return `${yearBs} B.S. (Baisakh–Chaitra)`;
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

function styleExcelAttendanceSheet(
  XLSX: any,
  worksheet: any,
  rowCount: number,
  columnCount: number,
  percentageColumn: number,
  statusStartColumn?: number,
) {
  const border = {
    top: { style: "thin", color: { rgb: "D9E2F3" } },
    bottom: { style: "thin", color: { rgb: "D9E2F3" } },
    left: { style: "thin", color: { rgb: "D9E2F3" } },
    right: { style: "thin", color: { rgb: "D9E2F3" } },
  };
  const centered = { horizontal: "center", vertical: "center", wrapText: true };

  [
    { row: 0, size: 16, bold: true, color: "17365D" },
    { row: 1, size: 11, bold: false, color: "666666" },
    { row: 2, size: 14, bold: true, color: "17365D" },
    { row: 3, size: 11, bold: true, color: "1F1F1F" },
  ].forEach(({ row, size, bold, color }) => {
    const titleCell = worksheet[XLSX.utils.encode_cell({ r: row, c: 0 })];
    if (titleCell) {
      titleCell.s = {
        font: { name: "Arial", sz: size, bold, color: { rgb: color } },
        alignment: centered,
      };
    }
  });

  for (let column = 0; column < columnCount; column += 1) {
    const headerCell = worksheet[XLSX.utils.encode_cell({ r: 5, c: column })];
    if (headerCell) {
      headerCell.s = {
        font: { name: "Arial", sz: 10, bold: true, color: { rgb: "FFFFFF" } },
        fill: { patternType: "solid", fgColor: { rgb: "17365D" } },
        alignment: centered,
        border,
      };
    }
  }

  const statusColors: Record<string, { fill: string; font: string }> = {
    P: { fill: "E2F0D9", font: "375623" },
    A: { fill: "FCE4D6", font: "C00000" },
    L: { fill: "FFF2CC", font: "9C6500" },
    S: { fill: "DDEBF7", font: "1F4E78" },
  };

  for (let row = 6; row < rowCount; row += 1) {
    for (let column = 0; column < columnCount; column += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      const cell = worksheet[address];
      if (!cell) continue;
      const academicStatus = statusStartColumn === undefined
        ? ({ 2: statusColors.P, 3: statusColors.A, 4: statusColors.L, 5: statusColors.S } as Record<number, { fill: string; font: string }>)[column]
        : undefined;
      const status = statusStartColumn !== undefined && column >= statusStartColumn
        ? statusColors[String(cell.v ?? "").toUpperCase()]
        : academicStatus;
      cell.s = {
        font: {
          name: "Arial",
          sz: 10,
          bold: Boolean(status),
          color: { rgb: status?.font ?? "1F1F1F" },
        },
        fill: {
          patternType: "solid",
          fgColor: { rgb: status?.fill ?? (row % 2 === 0 ? "FFFFFF" : "F2F6FC") },
        },
        alignment: centered,
        border,
      };
    }

    const percentageCell = worksheet[
      XLSX.utils.encode_cell({ r: row, c: percentageColumn })
    ];
    if (percentageCell) {
      percentageCell.z = "0.0%";
      percentageCell.s = { ...percentageCell.s, numFmt: "0.0%" };
    }
  }

  worksheet["!rows"] = [
    { hpt: 27 }, { hpt: 21 }, { hpt: 25 }, { hpt: 22 }, { hpt: 9 }, { hpt: 32 },
    ...Array.from({ length: Math.max(0, rowCount - 6) }, () => ({ hpt: 22 })),
  ];
  worksheet["!autofilter"] = {
    ref: `A6:${XLSX.utils.encode_col(columnCount - 1)}${rowCount}`,
  };
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
  const [reportMode, setReportMode] = useState<ReportMode>("monthly");
  const [academicYearBs, setAcademicYearBs] = useState<string>(
    monthFromBsDate(todayBs()).slice(0, 4),
  );
  const [pickerOpen, setPickerOpen] = useState(false);

  const [rows, setRows] = useState<MonthlyStudentSummary[]>([]);
  const [academicClassesHeld, setAcademicClassesHeld] = useState(0);
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

  useEffect(() => {
    if (!premiumOk && reportMode === "academic") {
      setReportMode("monthly");
    }
  }, [premiumOk, reportMode]);

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
        if (reportMode === "monthly") {
          const data = await getMonthlyAttendanceSummary({
            tenantId,
            classId,
            monthBs,
          });
          if (mounted) {
            setRows(data);
            setAcademicClassesHeld(0);
          }
        } else {
          const { buildMonthlyMatrix } =
            await import("../../src/db/reportRepo");
          const aggregated = new Map<string, MonthlyStudentSummary>();
          let classesHeld = 0;

          // Run database reads sequentially. This is friendlier to Expo/SQLite
          // than opening all twelve month queries at the same time.
          for (const academicMonth of academicMonthsForYear(academicYearBs)) {
            const matrix = await buildMonthlyMatrix({
              tenantId,
              classId,
              monthBs: academicMonth,
            });

            const heldDates = matrix.sessions
              .filter((session: any) => {
                if ((session?.dayType ?? "CLASS") !== "CLASS") return false;
                return matrix.students.some((student: any) => {
                  const status = String(
                    matrix.statusMap.get(`${student.id}__${session.dateBs}`) ?? "",
                  ).toUpperCase();
                  return status === "P" || status === "A" || status === "L" || status === "S";
                });
              })
              .map((session: any) => session.dateBs);

            classesHeld += heldDates.length;
            for (const student of matrix.students as any[]) {
              let current = aggregated.get(student.id);
              if (!current) {
                current = {
                  studentId: student.id,
                  rollNo: student.rollNo,
                  name: student.name,
                  present: 0,
                  absent: 0,
                  leave: 0,
                  sick: 0,
                  total: 0,
                  percentage: 0,
                };
                aggregated.set(student.id, current);
              }

              for (const dateBs of heldDates) {
                const status = String(
                  matrix.statusMap.get(`${student.id}__${dateBs}`) ?? "",
                ).toUpperCase();
                if (status === "P") current.present += 1;
                else if (status === "A") current.absent += 1;
                else if (status === "L") current.leave += 1;
                else if (status === "S") current.sick += 1;
              }
            }
          }

          for (const student of aggregated.values()) {
            student.total = classesHeld;
            student.percentage = classesHeld
              ? Math.round((student.present / classesHeld) * 10_000) / 100
              : 0;
          }

          const data = Array.from(aggregated.values()).sort(
            (a, b) => Number(a.rollNo) - Number(b.rollNo),
          );
          if (mounted) {
            setRows(data);
            setAcademicClassesHeld(classesHeld);
          }
        }
      } catch (e: any) {
        Alert.alert("Error", e?.message ?? "Failed to load report");
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [tenantId, classId, monthBs, academicYearBs, reportMode, refreshTick]);

  const selectedClass = useMemo(
    () => classes.find((c) => c.id === classId) ?? null,
    [classes, classId],
  );

  const totals = useMemo(() => {
    const totalDays = reportMode === "academic"
      ? academicClassesHeld
      : rows.length > 0
        ? Math.max(...rows.map((r) => r.total))
        : 0;
    const avg = rows.length
      ? Math.round(rows.reduce((sum, r) => sum + r.percentage, 0) / rows.length)
      : 0;
    return { totalDays, avg };
  }, [rows, reportMode, academicClassesHeld]);

  const { sumPresent, sumAbsent, sumTotal, overallRate } = useMemo(() => {
    const sp = rows.reduce((sum, r) => sum + (r.present || 0), 0);
    // In summary/report figures, Leave and Sick are treated as not present.
    // Their original values remain untouched so the detail modal can still
    // show Absent, Leave and Sick dates separately.
    const sa = rows.reduce(
      (sum, r) => sum + (r.absent || 0) + (r.leave || 0) + (r.sick || 0),
      0,
    );
    const st = rows.reduce((sum, r) => sum + (r.total || 0), 0);

    const rate = st > 0 ? Math.round((sp / st) * 100) : 0;
    return { sumPresent: sp, sumAbsent: sa, sumTotal: st, overallRate: rate };
  }, [rows]);

  const onPickDate = (picked: string) => {
    // Future dates are disabled by maxDate; keep this as a silent safeguard.
    if (isFutureBs(picked)) return;

    if (reportMode === "academic") {
      setAcademicYearBs(picked.slice(0, 4));
    } else {
      setMonthBs(monthFromBsDate(picked));
    }
    setPickerOpen(false);
  };

  const selectReportMode = (nextMode: ReportMode) => {
    if (nextMode === "academic" && !premiumOk) {
      Alert.alert(
        "Premium required",
        "Academic Year Report is a premium feature. Activate Premium in Settings.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Go to Settings", onPress: () => router.push("/(tabs)/settings") },
        ],
      );
      return;
    }
    setReportMode(nextMode);
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

  function writeCacheExport(fileName: string, base64: string): string {
    const file = new File(Paths.cache, fileName);
    file.create({ overwrite: true, intermediates: true });
    file.write(base64, { encoding: "base64" });
    return file.uri;
  }

  async function saveExportToDownloads(
    fileName: string,
    base64: string,
    mimeType: string,
  ) {
    // Android: use Storage Access Framework so user chooses folder once
    if (Platform.OS === "android" && LegacyFileSystem.StorageAccessFramework) {
      const cached = await AsyncStorage.getItem(EXPORT_DIR_KEY);

      const writeToDir = async (dirUri: string) => {
        const fileUri = await LegacyFileSystem.StorageAccessFramework.createFileAsync(
          dirUri,
          fileName,
          mimeType,
        );
        // SAF returns a content:// URI. Use its compatible writer instead of
        // File.write(), which can open Android SAF files as read-only.
        await LegacyFileSystem.writeAsStringAsync(fileUri, base64, {
          encoding: LegacyFileSystem.EncodingType.Base64,
        });

        // Optional share copy
        try {
          if (Sharing && (await Sharing.isAvailableAsync())) {
            const shareUri = writeCacheExport(fileName, base64);
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
        await LegacyFileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!perm.granted) {
        throw new Error("Folder permission not granted.");
      }
      await AsyncStorage.setItem(EXPORT_DIR_KEY, perm.directoryUri);
      await writeToDir(perm.directoryUri);
      return;
    }

    // iOS / others: save to cache and share
    const uri = writeCacheExport(fileName, base64);
    if (Sharing && (await Sharing.isAvailableAsync())) {
      await Sharing.shareAsync(uri, { mimeType });
    } else {
      Alert.alert("Saved", `Saved to: ${uri}`);
    }
  }

  async function exportAcademicYearExcel() {
    if (!tenantId || !selectedClass || rows.length === 0) {
      Alert.alert("Nothing to export", "No attendance data found for this academic year.");
      return;
    }

    const classLabel = formatClassWithSection(selectedClass);
    const XLSX: any = await import("xlsx-js-style");
    const sheetRows: (string | number)[][] = [
      [tenant.schoolName],
      [tenant.schoolAddress],
      [`ACADEMIC YEAR ATTENDANCE REPORT — ${academicYearBs} B.S.`],
      [classLabel],
      [],
      [
        "Roll", "Student Name", "Present", "Absent", "Leave", "Sick",
        "Classes Held", "Attendance Percentage",
      ],
      ...rows.map((student) => [
        student.rollNo,
        student.name,
        student.present,
        student.absent,
        student.leave,
        student.sick,
        academicClassesHeld,
        student.percentage / 100,
      ]),
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(sheetRows);
    worksheet["!merges"] = [0, 1, 2, 3].map((row) => ({
      s: { r: row, c: 0 },
      e: { r: row, c: 7 },
    }));
    worksheet["!cols"] = [10, 28, 12, 12, 12, 12, 14, 20].map((wch) => ({ wch }));
    styleExcelAttendanceSheet(XLSX, worksheet, sheetRows.length, 8, 7);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Academic Year Report");

    const className = classLabel.replace(/[^a-z0-9_-]+/gi, "_");
    const fileName = `${className}_Academic_Year_Report_${academicYearBs}.xlsx`;
    const base64 = XLSX.write(workbook, {
      type: "base64",
      bookType: "xlsx",
      cellStyles: true,
    });
    await saveExportToDownloads(
      fileName,
      base64,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    Alert.alert("Exported", `Saved: ${fileName}`);
  }

  async function exportAcademicYearPdf() {
    if (!selectedClass || rows.length === 0) {
      Alert.alert("Nothing to export", "No attendance data found for this academic year.");
      return;
    }

    const classLabel = formatClassWithSection(selectedClass);
    const tableRows = rows
      .map(
        (student) => `<tr>
          <td class="center">${escapeHtml(student.rollNo)}</td>
          <td>${escapeHtml(student.name)}</td>
          <td class="center present">${student.present}</td>
          <td class="center absent">${student.absent}</td>
          <td class="center leave">${student.leave}</td>
          <td class="center sick">${student.sick}</td>
          <td class="center">${student.total}</td>
          <td class="center rate">${student.percentage}%</td>
        </tr>`,
      )
      .join("");
    const notPresent = rows.reduce(
      (sum, row) => sum + row.absent + row.leave + row.sick,
      0,
    );
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8" />
      <style>
        @page { size: A4 landscape; margin: 14mm 12mm; }
        * { box-sizing: border-box; }
        body { font-family: Arial, sans-serif; color: #1f2937; margin: 0; font-size: 10px; }
        .school { text-align: center; color: #17365d; font-size: 20px; font-weight: 800; margin: 0; }
        .address, .meta { text-align: center; color: #64748b; font-size: 11px; margin-top: 4px; }
        .title { text-align: center; color: #17365d; font-size: 15px; font-weight: 800; margin-top: 12px; }
        .summary { display: flex; gap: 8px; margin: 14px 0 12px; }
        .box { flex: 1; border: 1px solid #d9e2f3; border-radius: 7px; padding: 8px; text-align: center; background: #f8fafc; }
        .value { font-size: 16px; font-weight: 800; color: #17365d; }
        .label { margin-top: 2px; color: #64748b; font-size: 9px; font-weight: 700; }
        table { width: 100%; border-collapse: collapse; } thead { display: table-header-group; }
        tr { page-break-inside: avoid; } th { background: #17365d; color: white; padding: 7px 5px; border: 1px solid #b4c6e7; font-size: 9px; }
        td { padding: 6px 5px; border: 1px solid #d9e2f3; } tbody tr:nth-child(even) { background: #f2f6fc; }
        .center { text-align: center; } .present { color: #2563eb; font-weight: 800; }
        .absent { color: #dc2626; font-weight: 800; } .leave { color: #b45309; font-weight: 800; }
        .sick { color: #4338ca; font-weight: 800; } .rate { color: #17365d; font-weight: 800; }
        .footer { margin-top: 10px; text-align: right; color: #94a3b8; font-size: 8px; }
      </style></head><body>
      <h1 class="school">${escapeHtml(tenant.schoolName)}</h1>
      <div class="address">${escapeHtml(tenant.schoolAddress)}</div>
      <div class="title">ACADEMIC YEAR ATTENDANCE REPORT</div>
      <div class="meta">${escapeHtml(formatAcademicYearBs(academicYearBs))} | ${escapeHtml(classLabel)}</div>
      <div class="summary">
        <div class="box"><div class="value">${rows.length}</div><div class="label">Students</div></div>
        <div class="box"><div class="value">${totals.totalDays}</div><div class="label">Classes Held</div></div>
        <div class="box"><div class="value">${sumPresent}</div><div class="label">Total Present</div></div>
        <div class="box"><div class="value">${notPresent}</div><div class="label">Total Not Present</div></div>
        <div class="box"><div class="value">${overallRate}%</div><div class="label">Attendance Rate</div></div>
      </div>
      <table><thead><tr><th>Roll</th><th>Student Name</th><th>Present</th><th>Absent</th><th>Leave</th><th>Sick</th><th>Classes Held</th><th>Attendance</th></tr></thead>
      <tbody>${tableRows}</tbody></table>
      <div class="footer">Generated by Nepali Attendance</div>
      </body></html>`;

    const pdf = await Print.printToFileAsync({ html, base64: true });
    if (!pdf.base64) throw new Error("PDF data could not be generated.");
    const className = classLabel.replace(/[^a-z0-9_-]+/gi, "_");
    const fileName = `${className}_Academic_Year_Report_${academicYearBs}.pdf`;
    await saveExportToDownloads(fileName, pdf.base64, "application/pdf");
    Alert.alert("Exported", `Saved: ${fileName}`);
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

    if (reportMode === "academic") {
      try {
        await exportAcademicYearExcel();
      } catch (e: any) {
        Alert.alert("Export failed", e?.message ?? "Could not export academic year Excel report.");
      }
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

      const lastColumn = header.length;
      const heldDateSet = new Set(
        sessions
          .filter((session: any) => {
            if ((session?.dayType ?? "CLASS") !== "CLASS") return false;
            return students.some((student: any) => {
              const status = String(
                statusMap.get(`${student.id}__${session.dateBs}`) ?? "",
              ).toUpperCase();
              return status === "P" || status === "A" || status === "L" || status === "S";
            });
          })
          .map((session: any) => session.dateBs),
      );
      const classesHeld = heldDateSet.size;
      const reportRows: (string | number)[][] = [];

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
          if (status === "P" && heldDateSet.has(s.dateBs)) attended += 1;
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
        reportRows.push([
          st.rollNo,
          st.name,
          classesHeld,
          attended,
          pct,
          ...cells,
        ]);
      }
      const XLSX: any = await import("xlsx-js-style");
      const sheetRows: (string | number)[][] = [
        [tenant.schoolName],
        [tenant.schoolAddress],
        [`MONTHLY ATTENDANCE REPORT — ${formatReportMonthBs(monthBs).toUpperCase()}`],
        [formatClassWithSection(selectedClass)],
        [],
        header,
        ...reportRows,
      ];
      const worksheet = XLSX.utils.aoa_to_sheet(sheetRows);
      worksheet["!merges"] = [0, 1, 2, 3].map((row) => ({
        s: { r: row, c: 0 },
        e: { r: row, c: lastColumn - 1 },
      }));
      worksheet["!cols"] = header.map((_, index) => ({
        wch: index === 1 ? 28 : index >= 5 ? 13 : 16,
      }));
      styleExcelAttendanceSheet(
        XLSX,
        worksheet,
        sheetRows.length,
        lastColumn,
        4,
        5,
      );
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Attendance Report");

      const className = formatClassWithSection(selectedClass).replace(
        /[^a-z0-9_-]+/gi,
        "_",
      );
      const fileName = `🏫${className}_Attendance_Report_${monthBs}.xlsx`;
      const base64 = XLSX.write(workbook, {
        type: "base64",
        bookType: "xlsx",
        cellStyles: true,
      });

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

    if (reportMode === "academic") {
      try {
        await exportAcademicYearPdf();
      } catch (e: any) {
        Alert.alert("Export failed", e?.message ?? "Could not export academic year PDF report.");
      }
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
              <div class="summary-box"><div class="summary-value">${sumAbsent}</div><div class="summary-label">Total Not Present</div></div>
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

      <NepaliDatePicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onDateSelect={onPickDate}
        date={
          reportMode === "academic"
            ? `${academicYearBs}-01-01`
            : `${monthBs}-01`
        }
        maxDate={todayBs()}
        brandColor={Colors.primary}
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
                <Text style={styles.title}>
                  {reportMode === "academic"
                    ? "Academic Year Summary"
                    : "Monthly Summary"}
                </Text>
                <Text style={styles.subtitle}>
                  {reportMode === "academic" ? "Academic Year: " : "BS Month: "}
                  <Text style={{ fontWeight: "900" }}>
                    {reportMode === "academic" ? academicYearBs : monthBs}
                  </Text>
                  {"  "}•{"  "}
                  {premiumOk ? "Premium Active" : "Premium Locked"}
                </Text>
              </View>
            </View>

            <View style={styles.modeSwitch}>
              <Pressable
                onPress={() => selectReportMode("monthly")}
                style={[
                  styles.modeButton,
                  reportMode === "monthly" && styles.modeButtonActive,
                ]}
              >
                <Ionicons
                  name="calendar-outline"
                  size={17}
                  color={reportMode === "monthly" ? "#FFFFFF" : Colors.textSecondary}
                />
                <Text
                  style={[
                    styles.modeButtonText,
                    reportMode === "monthly" && styles.modeButtonTextActive,
                  ]}
                >
                  Monthly
                </Text>
              </Pressable>
              <Pressable
                onPress={() => selectReportMode("academic")}
                style={[
                  styles.modeButton,
                  reportMode === "academic" && styles.modeButtonActive,
                ]}
              >
                <Ionicons
                  name={premiumOk ? "school-outline" : "lock-closed-outline"}
                  size={17}
                  color={reportMode === "academic" ? "#FFFFFF" : Colors.textSecondary}
                />
                <Text
                  style={[
                    styles.modeButtonText,
                    reportMode === "academic" && styles.modeButtonTextActive,
                  ]}
                >
                  Academic Year
                </Text>
              </Pressable>
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
                <Text style={styles.pickerText}>
                  {reportMode === "academic"
                    ? formatAcademicYearBs(academicYearBs)
                    : monthBs}
                </Text>
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

            {/* Class-wise report summary */}
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
                    {reportMode === "academic" ? "Academic Year: " : "Month (BS): "}
                    <Text
                      style={{ fontWeight: "900", color: Colors.textPrimary }}
                    >
                      {reportMode === "academic" ? academicYearBs : monthBs}
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
                  Overall attendance rate for this {reportMode === "academic" ? "academic year" : "month"} (based on all students)
                </Text>
              </View>
            </View>

            <Text style={styles.listTitle}>Students</Text>
            <Text style={styles.listSub}>
              {reportMode === "monthly"
                ? "Swipe anywhere to scroll • Tap a card to view date details"
                : "Baisakh–Chaitra totals for the selected class"}
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
              Take attendance for this {reportMode === "academic" ? "academic year" : "month"}, then come back here.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={
              reportMode === "monthly"
                ? () => openStudentDetails(item)
                : undefined
            }
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
                {item.present} present • {item.absent + item.leave + item.sick}{" "}
                absent • {item.total}{" "}
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
                  {item.absent + item.leave + item.sick}
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

  modeSwitch: {
    flexDirection: "row",
    gap: 8,
    padding: 4,
    marginBottom: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: "#F1F5F9",
  },
  modeButton: {
    flex: 1,
    minHeight: 42,
    paddingHorizontal: 10,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  modeButtonActive: { backgroundColor: Colors.primary },
  modeButtonText: { color: Colors.textSecondary, fontSize: 12, fontWeight: "900" },
  modeButtonTextActive: { color: "#FFFFFF" },

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
