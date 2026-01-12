import * as SQLite from "expo-sqlite";
import { initSchema } from "./schema";

let db: SQLite.SQLiteDatabase | null = null;

export async function getDb() {
  if (!db) db = await SQLite.openDatabaseAsync("nepaliattendance.db");
  await initSchema(db);
  return db;
}
