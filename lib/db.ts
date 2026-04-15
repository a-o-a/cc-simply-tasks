import path from "path";
import { pathToFileURL } from "url";
import { createClient, type Client } from "@libsql/client/node";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./db/schema";

type DbClient = ReturnType<typeof drizzle>;
type DatabaseState = {
  sqlite: Client | undefined;
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

function resolveSqliteClientUrl() {
  return pathToFileURL(resolveSqliteFilePath()).toString();
}

function initDb() {
  if (globalForDb.sqlite && globalForDb.db) {
    return { sqlite: globalForDb.sqlite, db: globalForDb.db };
  }

  const sqlite = createClient({
    url: resolveSqliteClientUrl(),
  });

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
