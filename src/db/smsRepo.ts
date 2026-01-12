// src/db/smsRepo.ts
import { getDb } from "./db";

export type SmsOutboxStatus = "queued" | "sent" | "failed";

export type SmsOutboxItem = {
  id: string;
  tenantId: string;
  classId: string;
  studentId: string;
  bsDate: string;
  phone: string;
  message: string;
  status: SmsOutboxStatus;
  queuedAt: number;
  sentAt?: number | null;
  lastError?: string | null;
};

export async function getSmsEnabled(tenantId: string, classId: string): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ enabled: number }>(
    `SELECT enabled FROM sms_class_prefs WHERE tenantId = ? AND classId = ?`,
    [tenantId, classId]
  );
  return (row?.enabled ?? 0) === 1;
}

export async function setSmsEnabled(tenantId: string, classId: string, enabled: boolean) {
  const db = await getDb();
  const now = Date.now();
  await db.runAsync(
    `
    INSERT INTO sms_class_prefs (tenantId, classId, enabled, updatedAt)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(tenantId, classId)
    DO UPDATE SET enabled = excluded.enabled, updatedAt = excluded.updatedAt;
    `,
    [tenantId, classId, enabled ? 1 : 0, now]
  );
}

export async function countQueuedForClassAndDate(tenantId: string, classId: string, bsDate: string) {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) as c FROM sms_outbox WHERE tenantId = ? AND classId = ? AND bsDate = ? AND status = 'queued'`,
    [tenantId, classId, bsDate]
  );
  return row?.c ?? 0;
}

export async function enqueueSmsBatch(items: Array<Omit<SmsOutboxItem, "status" | "queuedAt" | "sentAt" | "lastError">>) {
  const db = await getDb();
  const now = Date.now();

  // Insert each item. UNIQUE constraint prevents duplicates.
  for (const it of items) {
    await db.runAsync(
      `
      INSERT OR IGNORE INTO sms_outbox
        (id, tenantId, classId, studentId, bsDate, phone, message, status, queuedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?);
      `,
      [it.id, it.tenantId, it.classId, it.studentId, it.bsDate, it.phone, it.message, now]
    );
  }
}

export async function listQueued(limit = 50): Promise<SmsOutboxItem[]> {
  const db = await getDb();
  return await db.getAllAsync<SmsOutboxItem>(
    `
    SELECT id, tenantId, classId, studentId, bsDate, phone, message, status, queuedAt, sentAt, lastError
    FROM sms_outbox
    WHERE status = 'queued'
    ORDER BY queuedAt ASC
    LIMIT ?;
    `,
    [limit]
  );
}

export async function markSent(ids: string[]) {
  if (ids.length === 0) return;
  const db = await getDb();
  const now = Date.now();
  const placeholders = ids.map(() => "?").join(", ");
  await db.runAsync(
    `
    UPDATE sms_outbox
    SET status = 'sent', sentAt = ?, lastError = NULL
    WHERE id IN (${placeholders});
    `,
    [now, ...ids]
  );
}

export async function markFailed(id: string, error: string) {
  const db = await getDb();
  await db.runAsync(
    `
    UPDATE sms_outbox
    SET status = 'failed', lastError = ?
    WHERE id = ?;
    `,
    [error.slice(0, 500), id]
  );
}
