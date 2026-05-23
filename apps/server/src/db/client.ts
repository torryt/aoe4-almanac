import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { resolveDbPath } from "../env.ts";
import * as schema from "./schema.ts";

let sqliteInstance: Database.Database | undefined;
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function sqlite(): Database.Database {
  if (sqliteInstance) return sqliteInstance;
  const path = resolveDbPath();
  const conn = new Database(path);
  conn.pragma("journal_mode = WAL");
  conn.pragma("foreign_keys = ON");
  conn.pragma("synchronous = NORMAL");
  conn.pragma("busy_timeout = 5000");
  sqliteInstance = conn;
  return conn;
}

export function db() {
  if (dbInstance) return dbInstance;
  dbInstance = drizzle(sqlite(), { schema });
  return dbInstance;
}

export type Db = ReturnType<typeof db>;

export function closeDb(): void {
  sqliteInstance?.close();
  sqliteInstance = undefined;
  dbInstance = undefined;
}
