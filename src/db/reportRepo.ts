// src/db/reportRepo.ts
import { getDb } from "./db";
import NepaliDate from "nepali-date-converter";

export type MonthlyStudentSummary = {
  studentId: string;
  rollNo: number;
  name: string;
  present: number;
  absent: number;
  leave: number;
  sick: number;
  total: number; // classes held (CLASS days)
  percentage: number; // rounded to 2 decimals
};

function roundTo(value: number, decimals: number) {
  const f = Math.pow(10, decimals);
  return Math.round(value * f) / f;
}

export function formatAttendancePercentage(present: number, totalHeld: number): number {
  if (!totalHeld) return 0;
  return roundTo((present / totalHeld) * 100, 2);
}

function toIsoDate(d: Date): string {
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export type DayType = "CLASS" | "WEEKLY_OFF" | "HOLIDAY";

export async function ensureMonthSessions(params: {
  tenantId: string;
  classId: string;
  monthBs: string; // "YYYY-MM"
}) {
  const { tenantId, classId, monthBs } = params;
  const db = await getDb();
  const now = Date.now();

  const holidayRows = await db.getAllAsync<{ dateBs: string }>(
    `SELECT dateBs FROM holidays WHERE tenantId = ? AND dateBs LIKE ?;`,
    [tenantId, `${monthBs}-%`]
  );
  const holidaySet = new Set((holidayRows ?? []).map((h) => h.dateBs));

  let js = new NepaliDate(`${monthBs}-01`).toJsDate();

  while (true) {
    const bs = new NepaliDate(js).format("YYYY-MM-DD");
    if (!bs.startsWith(`${monthBs}-`)) break;

    const isSaturday = js.getDay() === 6;
    const dayType: DayType = holidaySet.has(bs) ? "HOLIDAY" : isSaturday ? "WEEKLY_OFF" : "CLASS";

    const id = `${tenantId}_${classId}_${bs}`;
    await db.runAsync(
      `
      INSERT INTO attendance_sessions (id, tenantId, classId, dateBs, dateAd, dayType, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenantId, classId, dateBs)
      DO UPDATE SET
        dateAd = excluded.dateAd,
        dayType = excluded.dayType,
        updatedAt = excluded.updatedAt;
      `,
      [id, tenantId, classId, bs, toIsoDate(js), dayType, now, now]
    );

    js = new Date(js.getTime() + 24 * 60 * 60 * 1000);
  }
}

export async function getMonthlyAttendanceSummary(params: {
  tenantId: string;
  classId: string;
  monthBs: string; // "YYYY-MM"
}): Promise<MonthlyStudentSummary[]> {
  const { tenantId, classId, monthBs } = params;
  const db = await getDb();

  // Ensure all dates exist (so totals are consistent)
  await ensureMonthSessions({ tenantId, classId, monthBs });

  const rows = await db.getAllAsync<{
    studentId: string;
    rollNo: number;
    name: string;
    present: number | null;
    absent: number | null;
    leave: number | null;
    sick: number | null;
    total: number | null;
  }>(
    `
    SELECT
      s.id AS studentId,
      s.rollNo AS rollNo,
      s.name AS name,
      COALESCE(SUM(CASE WHEN COALESCE(asess.dayType,'CLASS')='CLASS' AND ar.status = 'P' THEN 1 ELSE 0 END), 0) AS present,
      COALESCE(SUM(CASE WHEN COALESCE(asess.dayType,'CLASS')='CLASS' AND ar.status = 'A' THEN 1 ELSE 0 END), 0) AS absent,
      COALESCE(SUM(CASE WHEN COALESCE(asess.dayType,'CLASS')='CLASS' AND ar.status = 'L' THEN 1 ELSE 0 END), 0) AS leave,
      COALESCE(SUM(CASE WHEN COALESCE(asess.dayType,'CLASS')='CLASS' AND ar.status = 'S' THEN 1 ELSE 0 END), 0) AS sick,
      COALESCE(SUM(CASE WHEN COALESCE(asess.dayType,'CLASS')='CLASS' THEN 1 ELSE 0 END), 0) AS total
    FROM students s
    LEFT JOIN attendance_sessions asess
      ON asess.tenantId = s.tenantId
      AND asess.classId = s.classId
      AND asess.dateBs LIKE ?
    LEFT JOIN attendance_records ar
      ON ar.sessionId = asess.id
      AND ar.studentId = s.id
    WHERE s.tenantId = ? AND s.classId = ?
    GROUP BY s.id, s.rollNo, s.name
    ORDER BY s.rollNo ASC;
    `,
    [`${monthBs}-%`, tenantId, classId]
  );

  return (rows ?? []).map((r) => {
    const present = Number(r.present ?? 0);
    const absent = Number(r.absent ?? 0);
    const leave = Number(r.leave ?? 0);
    const sick = Number((r as any).sick ?? 0);
    const total = Number(r.total ?? 0);
    const percentage = formatAttendancePercentage(present, total);
    return {
      studentId: r.studentId,
      rollNo: r.rollNo,
      name: r.name,
      present,
      absent,
      leave,
      sick,
      total,
      percentage,
    };
  });
}

export type MatrixCell = "P" | "A" | "L" | "S" | "WO" | "H" | "";

/**
 * Build matrix data for CSV: all days of month (including Saturdays + holidays).
 */
export async function buildMonthlyMatrix(params: {
  tenantId: string;
  classId: string;
  monthBs: string; // "YYYY-MM"
}) {
  const { tenantId, classId, monthBs } = params;
  const db = await getDb();

  await ensureMonthSessions({ tenantId, classId, monthBs });

  // Pull holiday title too so exports can match the sample sheet (holiday cell shows the title).
  const sessions = await db.getAllAsync<{
    id: string;
    dateBs: string;
    dayType: DayType;
    holidayTitle: string | null;
  }>(
    `
    SELECT
      asess.id as id,
      asess.dateBs as dateBs,
      COALESCE(asess.dayType,'CLASS') as dayType,
      h.title as holidayTitle
    FROM attendance_sessions asess
    LEFT JOIN holidays h
      ON h.tenantId = asess.tenantId
     AND h.dateBs = asess.dateBs
    WHERE asess.tenantId = ? AND asess.classId = ? AND asess.dateBs LIKE ?
    ORDER BY asess.dateBs ASC;
    `,
    [tenantId, classId, `${monthBs}-%`]
  );

  const students = await db.getAllAsync<{ id: string; rollNo: number; name: string }>(
    `SELECT id, rollNo, name FROM students
     WHERE tenantId = ? AND classId = ?
     ORDER BY rollNo ASC;`,
    [tenantId, classId]
  );

  const recs = await db.getAllAsync<{ dateBs: string; studentId: string; status: string }>(
    `
    SELECT asess.dateBs as dateBs, ar.studentId as studentId, ar.status as status
    FROM attendance_sessions asess
    JOIN attendance_records ar ON ar.sessionId = asess.id
    WHERE asess.tenantId = ? AND asess.classId = ? AND asess.dateBs LIKE ?;
    `,
    [tenantId, classId, `${monthBs}-%`]
  );

  const statusMap = new Map<string, string>();
  for (const r of recs ?? []) {
    statusMap.set(`${r.studentId}__${r.dateBs}`, String(r.status ?? "").toUpperCase());
  }

  return { sessions: sessions ?? [], students: students ?? [], statusMap };
}

export function formatPercentString(p: number): string {
  // If integer, no decimals. Else 2 decimals.
  if (Number.isFinite(p) && Math.abs(p - Math.round(p)) < 1e-9) return `${Math.round(p)}%`;
  return `${p.toFixed(2)}%`;
}

export function dateColLabel(bs: string): string {
  // user wants "YYYY-M-D" style (no zero padding on month/day)
  const [y, m, d] = bs.split("-");
  return `${y}-${Number(m)}-${Number(d)}`;
}
