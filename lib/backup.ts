import path from "path";
import os from "os";
import fs from "fs/promises";
import { randomBytes } from "crypto";
import { getSqliteDbPath, openSqliteClient } from "./db";
import { HttpError } from "./errors";
import type { DownloadFile } from "./file-download";
import { sqliteStringLiteral } from "./request-security";

const BACKUP_RETAIN_DAYS = 7;
export const BACKUP_FILENAME_RE = /^backup_\d{4}-\d{2}-\d{2}(?:_\d{2}-\d{2}-\d{2}(?:_[a-f0-9]{8})?)?\.db$/;
const state = globalThis as typeof globalThis & {
  _backupPromise?: Promise<string>;
  _snapshotQueue?: Promise<void>;
};

async function getBackupDir(): Promise<string> {
  const dir = path.resolve(path.dirname(getSqliteDbPath()));
  return fs.realpath(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return dir;
    throw error;
  });
}

async function getSourcePaths(): Promise<Set<string>> {
  const configuredPath = path.resolve(getSqliteDbPath());
  const realPath = await fs.realpath(configuredPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return configuredPath;
    throw error;
  });
  return new Set([configuredPath, realPath]);
}

function timestamp(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

/** A separate connection and a serialized queue keep VACUUM outside application transactions. */
export async function createSnapshot(destination: string): Promise<void> {
  const previous = state._snapshotQueue ?? Promise.resolve();
  const job = previous.catch(() => undefined).then(async () => {
    const dbPath = getSqliteDbPath();
    const stat = await fs.stat(dbPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") throw new HttpError("NOT_FOUND", "DB 파일을 찾을 수 없습니다");
      throw error;
    });
    if (!stat.isFile()) throw new HttpError("NOT_FOUND", "DB 파일을 찾을 수 없습니다");
    // Build under an unlisted, exclusively owned name; publish without overwriting.
    const pending = `${destination}.${randomBytes(8).toString("hex")}.partial`;
    let reservation: Awaited<ReturnType<typeof fs.open>> | undefined;
    let ownsPendingFile = false;
    let sqlite: ReturnType<typeof openSqliteClient> | undefined;
    try {
      reservation = await fs.open(pending, "wx", 0o600);
      ownsPendingFile = true;
      await reservation.close();
      reservation = undefined;
      sqlite = openSqliteClient(dbPath);
      await sqlite.execute("PRAGMA busy_timeout = 5000");
      await sqlite.execute(`VACUUM INTO ${sqliteStringLiteral(pending)}`);
      await fs.link(pending, destination);
    } finally {
      // Each cleanup runs even when the preceding close fails.
      try {
        await reservation?.close();
      } finally {
        try {
          sqlite?.close();
        } finally {
          if (ownsPendingFile) {
            await fs.unlink(pending).catch((error: NodeJS.ErrnoException) => {
              if (error.code !== "ENOENT") throw error;
            });
          }
        }
      }
    }
  });
  state._snapshotQueue = job;
  await job;
}

export async function listBackupFiles(): Promise<{ filename: string; size: number; date: string }[]> {
  const dir = await getBackupDir();
  const sourcePaths = await getSourcePaths();
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const files = await Promise.all(entries.filter((entry) => entry.isFile() && BACKUP_FILENAME_RE.test(entry.name) && !sourcePaths.has(path.resolve(dir, entry.name))).map(async (entry) => {
    try {
      const stat = await fs.lstat(path.join(dir, entry.name));
      if (!stat.isFile()) return null;
      return { filename: entry.name, size: stat.size, date: entry.name.replace(/^backup_/, "").replace(/(?:_[a-f0-9]{8})?\.db$/, "") };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }));
  return files.filter((file): file is NonNullable<typeof file> => file !== null).sort((a, b) => b.filename.localeCompare(a.filename));
}

async function pruneOldBackups() {
  const dir = await getBackupDir();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - BACKUP_RETAIN_DAYS);
  const cutoffDate = timestamp(cutoff).slice(0, 10);
  for (const file of await listBackupFiles()) {
    if (file.date.slice(0, 10) < cutoffDate) {
      await fs.unlink(path.join(dir, file.filename)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") console.error("[backup] 오래된 백업 삭제 실패:", error);
      });
    }
  }
}

/** Concurrent manual/scheduled requests share one snapshot. Existing files are never overwritten. */
export async function runBackup(): Promise<string> {
  if (!state._backupPromise) {
    state._backupPromise = (async () => {
      const dir = await getBackupDir();
      await fs.mkdir(dir, { recursive: true });
      const destination = path.join(dir, `backup_${timestamp()}_${randomBytes(4).toString("hex")}.db`);
      await createSnapshot(destination);
      await pruneOldBackups();
      return destination;
    })().finally(() => { state._backupPromise = undefined; });
  }
  return state._backupPromise;
}

export interface CurrentSnapshot extends DownloadFile {
  cleanup: () => Promise<void>;
}

/** Call cleanup after consuming the resource, including when delivery is abandoned. */
export async function createCurrentSnapshot(): Promise<CurrentSnapshot> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cc-simply-tasks-backup-"));
  const cleanup = () => fs.rm(dir, { recursive: true, force: true });
  try {
    const destination = path.join(dir, "snapshot.db");
    await createSnapshot(destination);
    return { filePath: destination, filename: `backup-${timestamp().slice(0, 10)}.db`, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function getBackupFile(filename: string): Promise<DownloadFile> {
  if (!BACKUP_FILENAME_RE.test(filename)) throw new HttpError("BAD_REQUEST", "잘못된 백업 파일명입니다");
  const filePath = path.resolve(await getBackupDir(), filename);
  if ((await getSourcePaths()).has(filePath)) {
    throw new HttpError("NOT_FOUND", "백업 파일을 찾을 수 없습니다");
  }
  return { filePath, filename };
}
