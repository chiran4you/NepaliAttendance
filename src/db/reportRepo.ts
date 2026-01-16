// src/db/reportRepo.ts
import { getDb } from "./db";

export type MonthlyStudentSummary = {
  studentId: string;
  rollNo: number;
  name: string;
  present: number;
  absent: number;
  total: number;
  percentage: number; // 0..100
};

/**
 * Monthly summary by BS month.
 * monthBs format: "YYYY-MM" (e.g. "2082-01")
 */
export async function getMonthlyAttendanceSummary(params: {
  tenantId: string;
  classId: string;
  monthBs: string;
}): Promise<MonthlyStudentSummary[]> {
  const { tenantId, classId, monthBs } = params;
  const db = await getDb();

  const like = `${monthBs}-%`;

  const rows = await db.getAllAsync<{
    studentId: string;
    rollNo: number;
    name: string;
    present: number | null;
    absent: number | null;
    total: number | null;
  }>(
    `
    SELECT
      s.id AS studentId,
      s.rollNo AS rollNo,
      s.name AS name,
      COALESCE(SUM(CASE WHEN ar.status = 'P' THEN 1 ELSE 0 END), 0) AS present,
      COALESCE(SUM(CASE WHEN ar.status = 'A' THEN 1 ELSE 0 END), 0) AS absent,
      COALESCE(COUNT(asess.id), 0) AS total
    FROM students s
    LEFT JOIN attendance_sessions asess
      ON asess.tenantId = s.tenantId
     AND asess.classId = s.classId
     AND asess.dateBs LIKE ?
    LEFT JOIN attendance_records ar
      ON ar.sessionId = asess.id
     AND ar.studentId = s.id
    WHERE s.tenantId = ?
      AND s.classId = ?
    GROUP BY s.id, s.rollNo, s.name
    ORDER BY s.rollNo ASC;
    `,
    [like, tenantId, classId]
  );

  return rows.map((r) => {
    const present = r.present ?? 0;
    const total = r.total ?? 0;
    const percentage = total > 0 ? Math.round((present / total) * 100) : 0;
    return {
      studentId: r.studentId,
      rollNo: r.rollNo,
      name: r.name,
      present,
      absent: r.absent ?? 0,
      total,
      percentage,
    };
  });
}

export type StudentMonthlyAttendanceDetail = {
  dateBs: string; // YYYY-MM-DD
  status: "P" | "A" | "U"; // U = unmarked / no record
};

/**
 * Student-wise daily attendance list for a BS month.
 * monthBs format: "YYYY-MM" (e.g. "2082-01")
 */
export async function getStudentMonthlyAttendanceDetails(params: {
  tenantId: string;
  classId: string;
  studentId: string;
  monthBs: string;
}): Promise<StudentMonthlyAttendanceDetail[]> {
  const { tenantId, classId, studentId, monthBs } = params;
  const db = await getDb();

  const like = `${monthBs}-%`;

  const rows = await db.getAllAsync<{ dateBs: string; status: string | null }>(
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

  return rows.map((r) => {
    const s = String(r.status ?? "").toUpperCase();
    const status = s === "P" ? "P" : s === "A" ? "A" : "U";
    return { dateBs: r.dateBs, status };
  });
}
