import { getDb } from "./db";

export type ClassItem = {
  id: string;
  tenantId: string;
  name: string;
  section?: string | null;
  createdAt: number;
};

export async function listClasses(tenantId: string): Promise<ClassItem[]> {
  const db = await getDb();
  return await db.getAllAsync<ClassItem>(
    `SELECT * FROM classes WHERE tenantId = ? ORDER BY createdAt DESC`,
    [tenantId]
  );
}

export async function countClasses(tenantId: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) as c FROM classes WHERE tenantId = ?`,
    [tenantId]
  );
  return row?.c ?? 0;
}

export async function addClass(c: ClassItem) {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO classes (id, tenantId, name, section, createdAt)
     VALUES (?, ?, ?, ?, ?)`,
    [c.id, c.tenantId, c.name, c.section ?? null, c.createdAt]
  );
}

export async function updateClass(input: {
  id: string;
  tenantId: string;
  name: string;
  section?: string | null;
}) {
  const db = await getDb();
  await db.runAsync(
    `UPDATE classes
     SET name = ?, section = ?
     WHERE id = ? AND tenantId = ?`,
    [input.name, input.section ?? null, input.id, input.tenantId]
  );
}

export async function deleteClass(id: string, tenantId: string) {
  const db = await getDb();
  await db.runAsync(`DELETE FROM classes WHERE id = ? AND tenantId = ?`, [
    id,
    tenantId,
  ]);
}
