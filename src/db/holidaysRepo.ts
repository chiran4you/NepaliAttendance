/**
 * src/db/holidaysRepo.ts
 * Public holidays (BS dates).
 */
import { getDb } from "./db";

export type Holiday = {
  tenantId: string;
  dateBs: string; // "YYYY-MM-DD"
  title?: string | null;
  createdAt: number;
};

export async function listHolidaysForMonth(params: { tenantId: string; monthBs: string }) {
  const { tenantId, monthBs } = params;
  const db = await getDb();
  const rows = await db.getAllAsync<Holiday>(
    `SELECT tenantId, dateBs, title, createdAt
     FROM holidays
     WHERE tenantId = ? AND dateBs LIKE ?
     ORDER BY dateBs ASC;`,
    [tenantId, `${monthBs}-%`]
  );
  return rows ?? [];
}

export async function upsertHoliday(params: { tenantId: string; dateBs: string; title?: string }) {
  const { tenantId, dateBs, title } = params;
  const db = await getDb();
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO holidays (tenantId, dateBs, title, createdAt)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(tenantId, dateBs) DO UPDATE SET title = excluded.title;`,
    [tenantId, dateBs, title ?? null, now]
  );
}

export async function deleteHoliday(params: { tenantId: string; dateBs: string }) {
  const { tenantId, dateBs } = params;
  const db = await getDb();
  await db.runAsync(`DELETE FROM holidays WHERE tenantId = ? AND dateBs = ?;`, [tenantId, dateBs]);
}
