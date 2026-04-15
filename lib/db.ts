import path from "path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./db/schema";

type DbClient = ReturnType<typeof drizzle>;
type DatabaseState = {
  sqlite: Database.Database | undefined;
  db: DbClient | undefined;
};

const globalForDb = globalThis as unknown as DatabaseState;

function resolveSqliteFilePath() {
  const rawUrl = process.env.DATABASE_URL ?? "file:./db/dev.db";
  if (!rawUrl.startsWith("file:")) {
    throw new Error("Only sqlite file DATABASE_URL values are supported");
  }

  const filePath = rawUrl.slice("file:".length);
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(process.cwd(), filePath);
}

function initDb() {
  if (globalForDb.sqlite && globalForDb.db) {
    return { sqlite: globalForDb.sqlite, db: globalForDb.db };
  }

  const sqlite = new Database(resolveSqliteFilePath(), {
    fileMustExist: false,
  });
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });

  globalForDb.sqlite = sqlite;
  globalForDb.db = db;

  return { sqlite, db };
}

export function getDb() {
  return initDb().db;
}

export function getSqlite() {
  return initDb().sqlite;
}

export const db = new Proxy({} as DbClient, {
  get(_target, prop, receiver) {
    const client = getDb() as unknown as Record<PropertyKey, unknown>;
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export function ensureSqlitePragma(): Promise<void> {
  return Promise.resolve();
}

export function getSqliteDbPath() {
  return resolveSqliteFilePath();
}
