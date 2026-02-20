// src/db/schema.ts
import type * as SQLite from "expo-sqlite";

/**
 * Run once per app start to ensure required tables exist.
 * Safe to call multiple times (uses IF NOT EXISTS).
 */
export async function initSchema(db: SQLite.SQLiteDatabase) {
  // Enable foreign keys (best-effort; SQLite requires per-connection)
  try {
    await db.execAsync("PRAGMA foreign_keys = ON;");
  } catch {
    // ignore
  }

  await db.execAsync(`
    /* ---------------- Core ---------------- */

    CREATE TABLE IF NOT EXISTS classes (
      id TEXT PRIMARY KEY NOT NULL,
      tenantId TEXT NOT NULL,
      name TEXT NOT NULL,
      section TEXT,
      createdAt INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_classes_tenant_createdAt
      ON classes (tenantId, createdAt);

    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY NOT NULL,
      tenantId TEXT NOT NULL,
      classId TEXT NOT NULL,
      rollNo INTEGER NOT NULL,
      name TEXT NOT NULL,
      dob TEXT,
      parentName TEXT,
      phone TEXT,
      address TEXT,
      createdAt INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_students_tenant_class_roll
      ON students (tenantId, classId, rollNo);

    /* ---------------- Attendance (Offline-first) ---------------- */

    CREATE TABLE IF NOT EXISTS attendance_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      tenantId TEXT NOT NULL,
      classId TEXT NOT NULL,
      dateBs TEXT NOT NULL,  -- BS date: "YYYY-MM-DD"
      dateAd TEXT NOT NULL,  -- AD date: ISO "YYYY-MM-DD"
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      UNIQUE (tenantId, classId, dateBs)
    );

    CREATE INDEX IF NOT EXISTS idx_att_sessions_tenant_class_date
      ON attendance_sessions (tenantId, classId, dateBs);

    CREATE TABLE IF NOT EXISTS attendance_records (
      sessionId TEXT NOT NULL,
      studentId TEXT NOT NULL,
      status TEXT NOT NULL,      -- "P" | "A" | "L"
      markedAt INTEGER NOT NULL,
      PRIMARY KEY (sessionId, studentId),
      FOREIGN KEY (sessionId) REFERENCES attendance_sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_att_records_session
      ON attendance_records (sessionId);

    /* ---------------- SMS Alerts (Premium, Offline Queue) ---------------- */

    -- Per-class toggle. Teachers can turn SMS ON/OFF per class.
    CREATE TABLE IF NOT EXISTS sms_class_prefs (
      tenantId TEXT NOT NULL,
      classId TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0, -- 0/1
      updatedAt INTEGER NOT NULL,
      PRIMARY KEY (tenantId, classId)
    );

    -- Outbox queue: one row per student per BS date (prevents duplicate SMS).
    CREATE TABLE IF NOT EXISTS sms_outbox (
      id TEXT PRIMARY KEY NOT NULL,
      tenantId TEXT NOT NULL,
      classId TEXT NOT NULL,
      studentId TEXT NOT NULL,
      bsDate TEXT NOT NULL,               -- "YYYY-MM-DD"
      phone TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL,               -- "queued" | "sent" | "failed"
      queuedAt INTEGER NOT NULL,
      sentAt INTEGER,
      lastError TEXT,
      UNIQUE (tenantId, classId, studentId, bsDate)
    );

    CREATE INDEX IF NOT EXISTS idx_sms_outbox_status
      ON sms_outbox (tenantId, status, queuedAt);

    CREATE INDEX IF NOT EXISTS idx_sms_outbox_class_date
      ON sms_outbox (tenantId, classId, bsDate);
  `);


  // --- Migrations for older installs ---
  // Older databases may have 'holidays' created without newer columns like title/createdAt.
  // CREATE TABLE IF NOT EXISTS won't change existing tables, so we patch them here.
  try {
    const cols = await db.getAllAsync<{ name: string }>("PRAGMA table_info(holidays);");
    const hasTitle = Array.isArray(cols) && cols.some((c) => c?.name === "title");
    const hasCreatedAt = Array.isArray(cols) && cols.some((c) => c?.name === "createdAt");

    if (!hasTitle) {
      await db.execAsync("ALTER TABLE holidays ADD COLUMN title TEXT;");
    }
    if (!hasCreatedAt) {
      // Adding a NOT NULL column requires a DEFAULT.
      await db.execAsync("ALTER TABLE holidays ADD COLUMN createdAt INTEGER NOT NULL DEFAULT 0;");
      // Best-effort backfill
      try {
        await db.execAsync(
          "UPDATE holidays SET createdAt = CAST(strftime('%s','now') AS INTEGER) * 1000 WHERE createdAt = 0;"
        );
      } catch {}
    }
  } catch {
    // ignore
  }

/* ---------------- Attendance Enhancements ---------------- */

// Add dayType to attendance_sessions (safe migration)
try {
  await db.execAsync(
    "ALTER TABLE attendance_sessions ADD COLUMN dayType TEXT NOT NULL DEFAULT 'CLASS';"
  );
} catch {
  // ignore if already exists
}

// Public holidays (BS dates) table
await db.execAsync(`
  CREATE TABLE IF NOT EXISTS holidays (
    tenantId TEXT NOT NULL,
    dateBs TEXT NOT NULL, -- "YYYY-MM-DD" (BS)
    title TEXT,
    createdAt INTEGER NOT NULL,
    PRIMARY KEY (tenantId, dateBs)
  );
`);

// Index for faster holiday lookups
await db.execAsync(`
  CREATE INDEX IF NOT EXISTS idx_holidays_tenant_dateBs
  ON holidays (tenantId, dateBs);
`);

  // --- Migration: ensure (tenantId, dateBs) is UNIQUE for holidays so UPSERT works ---
  try {
    // If an older DB had no UNIQUE/PK on (tenantId, dateBs), the ON CONFLICT clause will fail.
    // First, dedupe any accidental duplicates (keep the latest rowid).
    await db.execAsync(`
      DELETE FROM holidays
      WHERE rowid NOT IN (
        SELECT MAX(rowid) FROM holidays GROUP BY tenantId, dateBs
      );
    `);
    await db.execAsync(
      "CREATE UNIQUE INDEX IF NOT EXISTS ux_holidays_tenant_date ON holidays (tenantId, dateBs);"
    );
  } catch {
    // ignore
  }


}
