// src/db/attendanceRepo.ts
import { getDb } from "./db";
import NepaliDate from "nepali-date-converter";

export type AttendanceStatus = "P" | "A" | "L" | "S";
export type DayType = "CLASS" | "WEEKLY_OFF" | "HOLIDAY";

export type AttendanceSession = {
  id: string;
  tenantId: string;
  classId: string;
  dateBs: string; // "YYYY-MM-DD"
  dateAd: string; // ISO "YYYY-MM-DD"
  dayType?: DayType; // defaults to "CLASS"
  createdAt: number;
  updatedAt: number;
};

export type AttendanceRecord = {
  sessionId: string;
  studentId: string;
  status: AttendanceStatus;
  markedAt: number;
};

function toIsoDate(d: Date): string {
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

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

export async function getRecordsForSession(sessionId: string): Promise<AttendanceRecord[]> {
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

export async function isHoliday(tenantId: string, dateBs: string): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ dateBs: string }>(
    `SELECT dateBs FROM holidays WHERE tenantId = ? AND dateBs = ? LIMIT 1;`,
    [tenantId, dateBs]
  );
  return !!row;
}

/**
 * Ensure the session exists for a date (and assigns correct dayType: CLASS/WEEKLY_OFF/HOLIDAY).
 * Safe to call multiple times.
 */
export async function ensureSessionForDate(params: {
  tenantId: string;
  classId: string;
  dateBs: string; // "YYYY-MM-DD"
}): Promise<AttendanceSession> {
  const { tenantId, classId, dateBs } = params;
  const db = await getDb();
  const now = Date.now();

  // Compute dayType
  const js = new NepaliDate(dateBs).toJsDate();
  const saturday = js.getDay() === 6;
  const holiday = await isHoliday(tenantId, dateBs);
  const dayType: DayType = holiday ? "HOLIDAY" : saturday ? "WEEKLY_OFF" : "CLASS";

  const dateAd = toIsoDate(js);

  // Upsert session by UNIQUE(tenantId, classId, dateBs)
  const id = `${tenantId}_${classId}_${dateBs}`; // deterministic id is fine
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
    [id, tenantId, classId, dateBs, dateAd, dayType, now, now]
  );

  const session = await getSessionByBsDate(tenantId, classId, dateBs);
  // session must exist now
  return session as AttendanceSession;
}

/** Throw if the day is not a CLASS day */
export async function assertSessionIsClassDay(
  tenantId: string,
  classId: string,
  dateBs: string
) {
  const s = await ensureSessionForDate({ tenantId, classId, dateBs });
  const t = (s.dayType ?? "CLASS") as DayType;
  if (t !== "CLASS") {
    throw new Error(t === "WEEKLY_OFF" ? "Saturday (Weekly Off)" : "Public Holiday");
  }
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

  // Ensure session exists and is a CLASS day
  await assertSessionIsClassDay(params.tenantId, params.classId, params.dateBs);

  const existing = await getSessionByBsDate(params.tenantId, params.classId, params.dateBs);

  if (existing) {
    await db.runAsync(
      `UPDATE attendance_sessions SET dateAd = ?, updatedAt = ? WHERE id = ?;`,
      [params.dateAd, now, existing.id]
    );

    await db.runAsync(`DELETE FROM attendance_records WHERE sessionId = ?;`, [existing.id]);

    for (const r of params.records) {
      await db.runAsync(
        `INSERT INTO attendance_records (sessionId, studentId, status, markedAt) VALUES (?, ?, ?, ?);`,
        [existing.id, r.studentId, r.status, now]
      );
    }

    return { overwritten: true, sessionId: existing.id };
  }

  // Insert new session (dayType is already ensured in assertSessionIsClassDay -> ensureSessionForDate)
  const session = await ensureSessionForDate({
    tenantId: params.tenantId,
    classId: params.classId,
    dateBs: params.dateBs,
  });

  await db.runAsync(`DELETE FROM attendance_records WHERE sessionId = ?;`, [session.id]);

  for (const r of params.records) {
    await db.runAsync(
      `INSERT INTO attendance_records (sessionId, studentId, status, markedAt) VALUES (?, ?, ?, ?);`,
      [session.id, r.studentId, r.status, now]
    );
  }

  return { overwritten: false, sessionId: session.id };
}
