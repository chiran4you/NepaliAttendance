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

  const rows = await db.getAllAsync<{ rollNo: number }>(
    `SELECT rollNo FROM students
     WHERE tenantId = ? AND classId = ?
     ORDER BY rollNo ASC`,
    [tenantId, classId]
  );

  let expected = 1;
  for (const r of rows) {
    if (r.rollNo !== expected) return expected; // gap found
    expected++;
  }
  return expected; // no gaps -> next new roll
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


export async function addStudentManualRoll(s: StudentItem) {
  const db = await getDb();

  const exists = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) as c FROM students
     WHERE tenantId = ? AND classId = ? AND rollNo = ?`,
    [s.tenantId, s.classId, s.rollNo]
  );

  if ((exists?.c ?? 0) > 0) {
    throw new Error(`Roll number ${s.rollNo} is already taken.`);
  }

  await db.runAsync(
    `INSERT INTO students (id, tenantId, classId, rollNo, name, dob, parentName, phone, address, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      s.id,
      s.tenantId,
      s.classId,
      s.rollNo,
      s.name,
      s.dob ?? null,
      s.parentName ?? null,
      s.phone ?? null,
      s.address ?? null,
      s.createdAt,
    ]
  );
}




export async function updateStudent(input: {
  id: string;
  tenantId: string;
  name: string;
  dob?: string | null;
  parentName?: string | null;
  phone?: string | null;
  address?: string | null;
}) {
  const db = await getDb();
  await db.runAsync(
    `UPDATE students
     SET name = ?, dob = ?, parentName = ?, phone = ?, address = ?
     WHERE id = ? AND tenantId = ?`,
    [
      input.name,
      input.dob ?? null,
      input.parentName ?? null,
      input.phone ?? null,
      input.address ?? null,
      input.id,
      input.tenantId,
    ]
  );
}

export async function deleteStudent(id: string, tenantId: string) {
  const db = await getDb();
  await db.runAsync(`DELETE FROM students WHERE id = ? AND tenantId = ?`, [id, tenantId]);
}
