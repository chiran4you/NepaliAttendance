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
