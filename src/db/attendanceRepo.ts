// src/db/attendanceRepo.ts
import { getDb } from "./db";

export type AttendanceStatus = "P" | "A";

export type AttendanceSession = {
  id: string;
  tenantId: string;
  classId: string;
  dateBs: string; // "YYYY-MM-DD"
  dateAd: string; // ISO "YYYY-MM-DD"
  createdAt: number;
  updatedAt: number;
};

export type AttendanceRecord = {
  sessionId: string;
  studentId: string;
  status: AttendanceStatus;
  markedAt: number;
};

export async function getSessionByBsDate(
  tenantId: string,
  classId: string,
  dateBs: string
): Promise<AttendanceSession | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<AttendanceSession>(
    `
    SELECT *
    FROM attendance_sessions
    WHERE tenantId = ? AND classId = ? AND dateBs = ?
    LIMIT 1;
    `,
    [tenantId, classId, dateBs]
  );
  return row ?? null;
}

export async function getRecordsForSession(
  sessionId: string
): Promise<AttendanceRecord[]> {
  const db = await getDb();
  return await db.getAllAsync<AttendanceRecord>(
    `
    SELECT *
    FROM attendance_records
    WHERE sessionId = ?
    ORDER BY studentId ASC;
    `,
    [sessionId]
  );
}

/**
 * Save attendance for a (tenantId, classId, dateBs).
 * If a session already exists for that date, its records are overwritten.
 */
export async function saveAttendanceForDate(params: {
  sessionId: string; // provide randomUUID()
  tenantId: string;
  classId: string;
  dateBs: string;
  dateAd: string;
  records: Array<{ studentId: string; status: AttendanceStatus }>;
}): Promise<{ overwritten: boolean; sessionId: string }> {
  const db = await getDb();
  const now = Date.now();

  const existing = await getSessionByBsDate(
    params.tenantId,
    params.classId,
    params.dateBs
  );

  if (existing) {
    // Overwrite: update session + delete old records
    await db.runAsync(
      `
      UPDATE attendance_sessions
      SET dateAd = ?, updatedAt = ?
      WHERE id = ?;
      `,
      [params.dateAd, now, existing.id]
    );

    await db.runAsync(`DELETE FROM attendance_records WHERE sessionId = ?;`, [
      existing.id,
    ]);

    for (const r of params.records) {
      await db.runAsync(
        `
        INSERT INTO attendance_records (sessionId, studentId, status, markedAt)
        VALUES (?, ?, ?, ?);
        `,
        [existing.id, r.studentId, r.status, now]
      );
    }

    return { overwritten: true, sessionId: existing.id };
  }

  // New session
  await db.runAsync(
    `
    INSERT INTO attendance_sessions
      (id, tenantId, classId, dateBs, dateAd, createdAt, updatedAt)
    VALUES
      (?, ?, ?, ?, ?, ?, ?);
    `,
    [
      params.sessionId,
      params.tenantId,
      params.classId,
      params.dateBs,
      params.dateAd,
      now,
      now,
    ]
  );

  for (const r of params.records) {
    await db.runAsync(
      `
      INSERT INTO attendance_records (sessionId, studentId, status, markedAt)
      VALUES (?, ?, ?, ?);
      `,
      [params.sessionId, r.studentId, r.status, now]
    );
  }

  return { overwritten: false, sessionId: params.sessionId };
}
