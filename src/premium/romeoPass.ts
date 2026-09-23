import { Buffer } from "buffer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from "expo-crypto";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import { getDb } from "../db/db";
import { validatePremiumEntitlement } from "./license";

const FORMAT = "nepali-attendance-romeo-pass";
const VERSION = 1;
const MAX_STUDENTS = 2_000;
const MAX_SESSIONS = 5_000;
const MAX_RECORDS = 250_000;

type TransferClass = {
  id: string;
  name: string;
  section: string | null;
  createdAt: number;
};

type TransferStudent = {
  id: string;
  rollNo: number;
  name: string;
  dob: string | null;
  parentName: string | null;
  phone: string | null;
  address: string | null;
  createdAt: number;
};

type TransferSession = {
  id: string;
  dateBs: string;
  dateAd: string;
  dayType: "CLASS" | "WEEKLY_OFF" | "HOLIDAY";
  createdAt: number;
  updatedAt: number;
};

type TransferRecord = {
  sessionId: string;
  studentId: string;
  status: "P" | "A" | "L" | "S";
  markedAt: number;
};

export type RomeoPassPayload = {
  format: typeof FORMAT;
  version: typeof VERSION;
  sourceTenantId: string;
  sourceSchoolName: string;
  exportedAt: number;
  class: TransferClass;
  students: TransferStudent[];
  sessions: TransferSession[];
  records: TransferRecord[];
};

type RomeoPassEnvelope = {
  format: typeof FORMAT;
  version: typeof VERSION;
  encoding: "base64-json";
  payload: string;
  checksum: string;
};

export type RomeoPassPreview = {
  className: string;
  section: string | null;
  sourceSchoolName: string;
  exportedAt: number;
  studentCount: number;
  attendanceDayCount: number;
  attendanceRecordCount: number;
};

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid Romeo Pass: ${field} is missing.`);
  }
  return value;
}

function requireFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid Romeo Pass: ${field} is invalid.`);
  }
  return value;
}

function validatePayload(raw: unknown, targetTenantId: string): RomeoPassPayload {
  if (!raw || typeof raw !== "object") throw new Error("This is not a valid Romeo Pass file.");
  const payload = raw as RomeoPassPayload;

  if (payload.format !== FORMAT || payload.version !== VERSION) {
    throw new Error("This Romeo Pass version is not supported.");
  }
  if (requireText(payload.sourceTenantId, "school") !== targetTenantId) {
    throw new Error("This Romeo Pass belongs to a different school.");
  }
  requireText(payload.sourceSchoolName, "school name");
  requireFiniteNumber(payload.exportedAt, "export date");

  if (!payload.class || typeof payload.class !== "object") {
    throw new Error("Invalid Romeo Pass: class information is missing.");
  }
  requireText(payload.class.id, "class ID");
  requireText(payload.class.name, "class name");
  requireFiniteNumber(payload.class.createdAt, "class date");

  if (!Array.isArray(payload.students) || !Array.isArray(payload.sessions) || !Array.isArray(payload.records)) {
    throw new Error("Invalid Romeo Pass: class data is incomplete.");
  }
  if (payload.students.length > MAX_STUDENTS) throw new Error("Romeo Pass contains too many students.");
  if (payload.sessions.length > MAX_SESSIONS) throw new Error("Romeo Pass contains too many attendance days.");
  if (payload.records.length > MAX_RECORDS) throw new Error("Romeo Pass contains too many attendance records.");

  const studentIds = new Set<string>();
  const rollNos = new Set<number>();
  for (const student of payload.students) {
    const id = requireText(student?.id, "student ID");
    const name = requireText(student?.name, "student name");
    const rollNo = requireFiniteNumber(student?.rollNo, `roll number for ${name}`);
    requireFiniteNumber(student?.createdAt, `student date for ${name}`);
    if (!Number.isInteger(rollNo) || rollNo <= 0) throw new Error(`Invalid roll number for ${name}.`);
    if (studentIds.has(id)) throw new Error("Romeo Pass contains duplicate students.");
    if (rollNos.has(rollNo)) throw new Error("Romeo Pass contains duplicate roll numbers.");
    studentIds.add(id);
    rollNos.add(rollNo);
  }

  const sessionIds = new Set<string>();
  const sessionDates = new Set<string>();
  const allowedDayTypes = new Set(["CLASS", "WEEKLY_OFF", "HOLIDAY"]);
  for (const session of payload.sessions) {
    const id = requireText(session?.id, "attendance session ID");
    const dateBs = requireText(session?.dateBs, "Nepali attendance date");
    requireText(session?.dateAd, "attendance date");
    requireFiniteNumber(session?.createdAt, "attendance created date");
    requireFiniteNumber(session?.updatedAt, "attendance updated date");
    if (!allowedDayTypes.has(session?.dayType ?? "")) throw new Error(`Invalid day type for ${dateBs}.`);
    if (sessionIds.has(id) || sessionDates.has(dateBs)) {
      throw new Error("Romeo Pass contains duplicate attendance days.");
    }
    sessionIds.add(id);
    sessionDates.add(dateBs);
  }

  const recordKeys = new Set<string>();
  const allowedStatuses = new Set(["P", "A", "L", "S"]);
  for (const record of payload.records) {
    if (!sessionIds.has(record?.sessionId) || !studentIds.has(record?.studentId)) {
      throw new Error("Romeo Pass contains an attendance record with a missing student or date.");
    }
    if (!allowedStatuses.has(record?.status ?? "")) throw new Error("Romeo Pass contains an invalid attendance status.");
    requireFiniteNumber(record?.markedAt, "attendance marked date");
    const key = `${record.sessionId}:${record.studentId}`;
    if (recordKeys.has(key)) throw new Error("Romeo Pass contains duplicate attendance records.");
    recordKeys.add(key);
  }

  return payload;
}

function safeFilePart(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "Class";
}

function previewOf(payload: RomeoPassPayload): RomeoPassPreview {
  return {
    className: payload.class.name,
    section: payload.class.section ?? null,
    sourceSchoolName: payload.sourceSchoolName,
    exportedAt: payload.exportedAt,
    studentCount: payload.students.length,
    attendanceDayCount: payload.sessions.length,
    attendanceRecordCount: payload.records.length,
  };
}

export async function assertRomeoPassPremium(tenantId: string): Promise<void> {
  const raw = await AsyncStorage.getItem("premiumEntitlement");
  if (!raw) throw new Error("Romeo Pass requires an active Premium school license on this device.");

  try {
    const entitlement = JSON.parse(raw);
    const belongsToSchool = !entitlement?.tenantId || entitlement.tenantId === tenantId;
    const { valid } = validatePremiumEntitlement(entitlement);
    if (!belongsToSchool || !valid) {
      throw new Error("Romeo Pass requires an active Premium school license on this device.");
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Romeo Pass requires")) throw error;
    throw new Error("Romeo Pass requires an active Premium school license on this device.");
  }
}

export async function createAndShareRomeoPass(params: {
  tenantId: string;
  schoolName: string;
  classId: string;
}): Promise<RomeoPassPreview> {
  await assertRomeoPassPremium(params.tenantId);
  const db = await getDb();
  const selectedClass = await db.getFirstAsync<TransferClass>(
    `SELECT id, name, section, createdAt FROM classes WHERE id = ? AND tenantId = ? LIMIT 1`,
    [params.classId, params.tenantId]
  );
  if (!selectedClass) throw new Error("The selected class no longer exists.");

  const students = await db.getAllAsync<TransferStudent>(
    `SELECT id, rollNo, name, dob, parentName, phone, address, createdAt
     FROM students WHERE tenantId = ? AND classId = ? ORDER BY rollNo ASC`,
    [params.tenantId, params.classId]
  );
  const sessions = await db.getAllAsync<TransferSession>(
    `SELECT id, dateBs, dateAd, COALESCE(dayType, 'CLASS') AS dayType, createdAt, updatedAt
     FROM attendance_sessions WHERE tenantId = ? AND classId = ? ORDER BY dateBs ASC`,
    [params.tenantId, params.classId]
  );
  const records = sessions.length
    ? await db.getAllAsync<TransferRecord>(
        `SELECT ar.sessionId, ar.studentId, ar.status, ar.markedAt
         FROM attendance_records ar
         INNER JOIN attendance_sessions s ON s.id = ar.sessionId
         WHERE s.tenantId = ? AND s.classId = ?
         ORDER BY s.dateBs ASC, ar.studentId ASC`,
        [params.tenantId, params.classId]
      )
    : [];

  const payload: RomeoPassPayload = {
    format: FORMAT,
    version: VERSION,
    sourceTenantId: params.tenantId,
    sourceSchoolName: params.schoolName,
    exportedAt: Date.now(),
    class: selectedClass,
    students,
    sessions,
    records,
  };

  const payloadBase64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  const checksum = await digestStringAsync(CryptoDigestAlgorithm.SHA256, payloadBase64);
  const envelope: RomeoPassEnvelope = {
    format: FORMAT,
    version: VERSION,
    encoding: "base64-json",
    payload: payloadBase64,
    checksum,
  };

  const fileName = `${safeFilePart(selectedClass.name)}${
    selectedClass.section ? `_${safeFilePart(selectedClass.section)}` : ""
  }_${Date.now()}.romeopass`;
  const file = new File(Paths.cache, fileName);
  file.create({ overwrite: true, intermediates: true });
  file.write(JSON.stringify(envelope));

  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing is not available on this device.");
  await Sharing.shareAsync(file.uri, {
    mimeType: "application/json",
    dialogTitle: `Dā — ${selectedClass.name}`,
  });

  return previewOf(payload);
}

export async function readRomeoPassFile(base64: string, targetTenantId: string): Promise<{
  payload: RomeoPassPayload;
  preview: RomeoPassPreview;
}> {
  await assertRomeoPassPremium(targetTenantId);
  let envelope: RomeoPassEnvelope;
  try {
    envelope = JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
  } catch {
    throw new Error("The selected file is not a valid Romeo Pass.");
  }

  if (
    envelope?.format !== FORMAT ||
    envelope?.version !== VERSION ||
    envelope?.encoding !== "base64-json" ||
    typeof envelope?.payload !== "string" ||
    typeof envelope?.checksum !== "string"
  ) {
    throw new Error("The selected file is not a supported Romeo Pass.");
  }

  const checksum = await digestStringAsync(CryptoDigestAlgorithm.SHA256, envelope.payload);
  if (checksum.toLowerCase() !== envelope.checksum.toLowerCase()) {
    throw new Error("This Romeo Pass is damaged or has been changed.");
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8"));
  } catch {
    throw new Error("The Romeo Pass data could not be decoded.");
  }
  const payload = validatePayload(decoded, targetTenantId);
  return { payload, preview: previewOf(payload) };
}

export async function importRomeoPass(params: {
  tenantId: string;
  payload: RomeoPassPayload;
  maxClasses: number;
}): Promise<{ classId: string; preview: RomeoPassPreview }> {
  await assertRomeoPassPremium(params.tenantId);
  const payload = validatePayload(params.payload, params.tenantId);
  const db = await getDb();
  const newClassId = randomUUID();
  const studentIdMap = new Map(payload.students.map((student) => [student.id, randomUUID()]));
  const sessionIdMap = new Map(payload.sessions.map((session) => [session.id, randomUUID()]));

  await db.withTransactionAsync(async () => {
    const countRow = await db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) AS count FROM classes WHERE tenantId = ?`,
      [params.tenantId]
    );
    if ((countRow?.count ?? 0) >= params.maxClasses) {
      throw new Error(`This device already has the maximum of ${params.maxClasses} classes.`);
    }

    await db.runAsync(
      `INSERT INTO classes (id, tenantId, name, section, createdAt) VALUES (?, ?, ?, ?, ?)`,
      [newClassId, params.tenantId, payload.class.name, payload.class.section ?? null, Date.now()]
    );

    for (const student of payload.students) {
      await db.runAsync(
        `INSERT INTO students
          (id, tenantId, classId, rollNo, name, dob, parentName, phone, address, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          studentIdMap.get(student.id)!,
          params.tenantId,
          newClassId,
          student.rollNo,
          student.name,
          student.dob ?? null,
          student.parentName ?? null,
          student.phone ?? null,
          student.address ?? null,
          student.createdAt,
        ]
      );
    }

    for (const session of payload.sessions) {
      await db.runAsync(
        `INSERT INTO attendance_sessions
          (id, tenantId, classId, dateBs, dateAd, dayType, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sessionIdMap.get(session.id)!,
          params.tenantId,
          newClassId,
          session.dateBs,
          session.dateAd,
          session.dayType,
          session.createdAt,
          session.updatedAt,
        ]
      );
    }

    for (const record of payload.records) {
      await db.runAsync(
        `INSERT INTO attendance_records (sessionId, studentId, status, markedAt) VALUES (?, ?, ?, ?)`,
        [
          sessionIdMap.get(record.sessionId)!,
          studentIdMap.get(record.studentId)!,
          record.status,
          record.markedAt,
        ]
      );
    }
  });

  return { classId: newClassId, preview: previewOf(payload) };
}
