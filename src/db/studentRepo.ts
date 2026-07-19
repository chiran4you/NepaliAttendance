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

export async function arrangeStudentsAlphabetically(
  tenantId: string,
  classId: string
): Promise<void> {
  const db = await getDb();

  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT id
     FROM students
     WHERE tenantId = ? AND classId = ?
     ORDER BY name COLLATE NOCASE ASC, rollNo ASC`,
    [tenantId, classId]
  );

  await applyStudentRollOrder(
    tenantId,
    classId,
    rows.map((row) => row.id)
  );
}

export async function applyStudentRollOrder(
  tenantId: string,
  classId: string,
  orderedStudentIds: string[]
): Promise<void> {
  const db = await getDb();

  await db.withTransactionAsync(async () => {
    const rows = await db.getAllAsync<{ id: string; rollNo: number }>(
      `SELECT id, rollNo
       FROM students
       WHERE tenantId = ? AND classId = ?`,
      [tenantId, classId]
    );

    const existingIds = new Set(rows.map((row) => row.id));
    const uniqueOrderedIds = [...new Set(orderedStudentIds)];

    if (
      uniqueOrderedIds.length !== rows.length ||
      uniqueOrderedIds.some((id) => !existingIds.has(id))
    ) {
      throw new Error("Student order is incomplete or contains invalid students.");
    }

    const maxRoll = rows.reduce((max, row) => Math.max(max, row.rollNo), 0);
    const temporaryBase = maxRoll + rows.length + 1000;

    for (let index = 0; index < uniqueOrderedIds.length; index++) {
      await db.runAsync(
        `UPDATE students
         SET rollNo = ?
         WHERE id = ? AND tenantId = ? AND classId = ?`,
        [temporaryBase + index, uniqueOrderedIds[index], tenantId, classId]
      );
    }

    for (let index = 0; index < uniqueOrderedIds.length; index++) {
      await db.runAsync(
        `UPDATE students
         SET rollNo = ?
         WHERE id = ? AND tenantId = ? AND classId = ?`,
        [index + 1, uniqueOrderedIds[index], tenantId, classId]
      );
    }
  });
}

export async function arrangeStudentsReverseAlphabetically(
  tenantId: string,
  classId: string
): Promise<void> {
  const db = await getDb();

  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT id
     FROM students
     WHERE tenantId = ? AND classId = ?
     ORDER BY name COLLATE NOCASE DESC, rollNo ASC`,
    [tenantId, classId]
  );

  await applyStudentRollOrder(
    tenantId,
    classId,
    rows.map((row) => row.id)
  );
}

export type BulkStudentInput = {
  id: string;
  tenantId: string;
  classId: string;
  rollNo: number | null;
  name: string;
  dob?: string | null;
  parentName?: string | null;
  phone?: string | null;
  address?: string | null;
  createdAt: number;
};

export async function addStudentsBulk(rows: BulkStudentInput[]): Promise<number> {
  if (rows.length === 0) return 0;

  const db = await getDb();
  const tenantId = rows[0].tenantId;
  const classId = rows[0].classId;

  if (rows.some((row) => row.tenantId !== tenantId || row.classId !== classId)) {
    throw new Error("All imported students must belong to the same school and class.");
  }

  await db.withTransactionAsync(async () => {
    const existing = await db.getAllAsync<{ rollNo: number }>(
      `SELECT rollNo FROM students WHERE tenantId = ? AND classId = ? ORDER BY rollNo ASC`,
      [tenantId, classId]
    );

    const used = new Set(existing.map((row) => row.rollNo));
    const requested = rows.filter((row) => row.rollNo !== null).map((row) => row.rollNo as number);

    for (const rollNo of requested) {
      if (used.has(rollNo)) throw new Error(`Roll number ${rollNo} is already used in this class.`);
      if (requested.filter((value) => value === rollNo).length > 1) {
        throw new Error(`Roll number ${rollNo} appears more than once in the import file.`);
      }
    }

    let nextCandidate = 1;
    const nextAvailableRoll = () => {
      while (used.has(nextCandidate)) nextCandidate += 1;
      const value = nextCandidate;
      used.add(value);
      nextCandidate += 1;
      return value;
    };

    for (const row of rows) {
      const rollNo = row.rollNo ?? nextAvailableRoll();
      used.add(rollNo);

      await db.runAsync(
        `INSERT INTO students (id, tenantId, classId, rollNo, name, dob, parentName, phone, address, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.tenantId,
          row.classId,
          rollNo,
          row.name,
          row.dob ?? null,
          row.parentName ?? null,
          row.phone ?? null,
          row.address ?? null,
          row.createdAt,
        ]
      );
    }
  });

  return rows.length;
}
