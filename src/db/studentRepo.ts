import { getDb } from "./db";

export type StudentItem = {
  id: string;
  tenantId: string;
  classId: string;
  rollNo: number;
  name: string;
  dob?: string | null;       // YYYY-MM-DD
  parentName?: string | null;
  phone?: string | null;
  address?: string | null;
  createdAt: number;
};

export async function listStudents(tenantId: string, classId: string): Promise<StudentItem[]> {
  const db = await getDb();
  return await db.getAllAsync<StudentItem>(
    `SELECT * FROM students
     WHERE tenantId = ? AND classId = ?
     ORDER BY rollNo ASC`,
    [tenantId, classId]
  );
}

export async function getNextRollNo(tenantId: string, classId: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ m: number }>(
    `SELECT MAX(rollNo) as m FROM students WHERE tenantId = ? AND classId = ?`,
    [tenantId, classId]
  );
  return (row?.m ?? 0) + 1;
}

export async function addStudentAutoRoll(s: Omit<StudentItem, "rollNo">) {
  const db = await getDb();
  const rollNo = await getNextRollNo(s.tenantId, s.classId);

  await db.runAsync(
    `INSERT INTO students (id, tenantId, classId, rollNo, name, dob, parentName, phone, address, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      s.id,
      s.tenantId,
      s.classId,
      rollNo,
      s.name,
      s.dob ?? null,
      s.parentName ?? null,
      s.phone ?? null,
      s.address ?? null,
      s.createdAt,
    ]
  );
}

export async function deleteStudent(id: string, tenantId: string) {
  const db = await getDb();
  await db.runAsync(`DELETE FROM students WHERE id = ? AND tenantId = ?`, [id, tenantId]);
}
