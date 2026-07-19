import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as XLSX from "xlsx";

export const STUDENT_IMPORT_HEADERS = [
  "Roll Number",
  "Student's Name",
  "DOB (YYYY-MM-DD)",
  "Parent's Name",
  "Contact Number",
  "Address",
] as const;

export type StudentImportRow = {
  sourceRow: number;
  rollNo: number | null;
  name: string;
  dob: string | null;
  parentName: string | null;
  phone: string | null;
  address: string | null;
  errors: string[];
};

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeDob(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return text(value);
}

export function parseStudentWorkbook(base64: string): StudentImportRow[] {
  const workbook = XLSX.read(base64, { type: "base64", cellDates: true });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) throw new Error("The selected workbook has no sheets.");

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[firstSheet], {
    defval: "",
    raw: false,
  });

  const parsed = rows.map((row, index): StudentImportRow => {
    const rollText = text(row[STUDENT_IMPORT_HEADERS[0]]);
    const name = text(row[STUDENT_IMPORT_HEADERS[1]]);
    const dob = normalizeDob(row[STUDENT_IMPORT_HEADERS[2]]);
    const parentName = text(row[STUDENT_IMPORT_HEADERS[3]]);
    const phone = text(row[STUDENT_IMPORT_HEADERS[4]]);
    const address = text(row[STUDENT_IMPORT_HEADERS[5]]);
    const errors: string[] = [];

    let rollNo: number | null = null;
    if (rollText) {
      const n = Number(rollText);
      if (!Number.isInteger(n) || n <= 0) errors.push("Invalid roll number");
      else rollNo = n;
    }

    if (!name) errors.push("Student name is required");
    if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) errors.push("DOB must use YYYY-MM-DD");

    return {
      sourceRow: index + 2,
      rollNo,
      name,
      dob: dob || null,
      parentName: parentName || null,
      phone: phone || null,
      address: address || null,
      errors,
    };
  });

  const suppliedRolls = parsed.filter((r) => r.rollNo !== null);
  if (suppliedRolls.length > 0 && suppliedRolls.length !== parsed.length) {
    parsed.forEach((r) => r.errors.push("Use roll numbers for every row or leave all roll numbers blank"));
  }

  const seen = new Map<number, number>();
  for (const row of parsed) {
    if (row.rollNo === null) continue;
    const firstRow = seen.get(row.rollNo);
    if (firstRow) row.errors.push(`Duplicate roll number (also used in row ${firstRow})`);
    else seen.set(row.rollNo, row.sourceRow);
  }

  return parsed;
}

export async function createAndShareStudentTemplate(): Promise<void> {
  const students = [
    {
      [STUDENT_IMPORT_HEADERS[0]]: 1,
      [STUDENT_IMPORT_HEADERS[1]]: "Aarav Sharma",
      [STUDENT_IMPORT_HEADERS[2]]: "2013-05-21",
      [STUDENT_IMPORT_HEADERS[3]]: "Ramesh Sharma",
      [STUDENT_IMPORT_HEADERS[4]]: "9812345678",
      [STUDENT_IMPORT_HEADERS[5]]: "Butwal-11",
    },
    {
      [STUDENT_IMPORT_HEADERS[0]]: 2,
      [STUDENT_IMPORT_HEADERS[1]]: "Sita Thapa",
      [STUDENT_IMPORT_HEADERS[2]]: "2013-08-14",
      [STUDENT_IMPORT_HEADERS[3]]: "Gita Thapa",
      [STUDENT_IMPORT_HEADERS[4]]: "9801234567",
      [STUDENT_IMPORT_HEADERS[5]]: "Tilottama-5",
    },
  ];

  const instructions = [
    ["Student Import Instructions"],
    ["1", "Do not rename or reorder the headings in the Students sheet."],
    ["2", "Enter one student per row."],
    ["3", "Student's Name is required. All other fields are optional."],
    ["4", "Use YYYY-MM-DD for DOB, for example 2013-05-21."],
    ["5", "Format Contact Number as Text to preserve leading zeroes."],
    ["6", "Either provide roll numbers for every student or leave the entire Roll Number column blank."],
    ["7", "When all roll numbers are blank, the app assigns available roll numbers automatically."],
    ["8", "Do not merge cells or add extra heading rows."],
  ];

  const workbook = XLSX.utils.book_new();
  const studentSheet = XLSX.utils.json_to_sheet(students, { header: [...STUDENT_IMPORT_HEADERS] });
  studentSheet["!cols"] = [
    { wch: 14 },
    { wch: 24 },
    { wch: 18 },
    { wch: 24 },
    { wch: 18 },
    { wch: 28 },
  ];
  const instructionSheet = XLSX.utils.aoa_to_sheet(instructions);
  instructionSheet["!cols"] = [{ wch: 8 }, { wch: 95 }];

  XLSX.utils.book_append_sheet(workbook, studentSheet, "Students");
  XLSX.utils.book_append_sheet(workbook, instructionSheet, "Instructions");

  const base64 = XLSX.write(workbook, { type: "base64", bookType: "xlsx" });
  const uri = `${FileSystem.cacheDirectory}NepaliAttendance_Student_Import_Template.xlsx`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });

  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing is not available on this device.");
  await Sharing.shareAsync(uri, {
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    dialogTitle: "Save student import template",
    UTI: "org.openxmlformats.spreadsheetml.sheet",
  });
}
