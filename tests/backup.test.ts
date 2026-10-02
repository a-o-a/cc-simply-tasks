import assert from "assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";
import * as database from "../lib/db";
import { createCurrentSnapshot, createSnapshot, getBackupFile, listBackupFiles, runBackup } from "../lib/backup";
import { createFileDownloadResponse, openFileDownload } from "../lib/file-download";
import { HttpError } from "../lib/errors";

async function assertRemoved(filePath: string) {
  await assert.rejects(fs.stat(filePath), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
}

async function assertNoPartialFiles(dir: string) {
  assert.deepEqual((await fs.readdir(dir)).filter((name) => name.endsWith(".partial")), []);
}

/** These tests create their own database and never open the application's database. */
export async function runBackupTests() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cc-simply-tasks-backup-test-"));
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const dbPath = path.join(dir, "backup_2000-01-01.db");
  process.env.DATABASE_URL = `file:${dbPath}`;
  const source = database.openSqliteClient(dbPath);
  try {
    await source.execute("PRAGMA journal_mode = WAL");
    await source.execute("CREATE TABLE SnapshotTest (value TEXT NOT NULL)");
    await source.execute({ sql: "INSERT INTO SnapshotTest VALUES (?)", args: ["committed WAL data"] });
    assert.ok((await fs.stat(`${dbPath}-wal`)).size > 0, "The source has uncheckpointed WAL content");

    const existingPath = path.join(dir, "existing.db");
    const originalBytes = Buffer.from("previous successful backup");
    await fs.writeFile(existingPath, originalBytes);
    await assert.rejects(createSnapshot(existingPath), (error: NodeJS.ErrnoException) => error.code === "EEXIST");
    assert.deepEqual(await fs.readFile(existingPath), originalBytes, "A destination collision must preserve the existing file");
    await assertNoPartialFiles(dir);

    const snapshotPath = path.join(dir, "after-failure.db");
    await createSnapshot(snapshotPath);
    const snapshot = database.openSqliteClient(snapshotPath);
    try {
      const rows = await snapshot.execute("SELECT value FROM SnapshotTest");
      assert.equal(rows.rows[0].value, "committed WAL data", "Snapshots include committed WAL contents after a failed queued job");
      assert.equal((await snapshot.execute("PRAGMA integrity_check")).rows[0].integrity_check, "ok");
    } finally {
      snapshot.close();
    }
    assert.equal((await fs.stat(snapshotPath)).mode & 0o777, 0o600, "Published backups retain private permissions");

    const originalOpen = fs.open;
    try {
      // Fail after closing the reservation, as can happen when close itself rejects.
      fs.open = (async (...args: Parameters<typeof fs.open>) => {
        const handle = await originalOpen(...args);
        if (String(args[0]).endsWith(".partial")) {
          const close = handle.close.bind(handle);
          let failed = false;
          handle.close = async () => {
            await close();
            if (!failed) {
              failed = true;
              throw new Error("reservation close failure");
            }
          };
        }
        return handle;
      }) as typeof fs.open;
      await assert.rejects(createSnapshot(path.join(dir, "reservation-failed.db")), /reservation close failure/);
      await assertNoPartialFiles(dir);
    } finally {
      fs.open = originalOpen;
    }

    const originalClientFactory = database.openSqliteClient;
    const mutableDatabase = database as { openSqliteClient: typeof database.openSqliteClient };
    try {
      mutableDatabase.openSqliteClient = (filePath) => {
        const client = originalClientFactory(filePath);
        const close = client.close.bind(client);
        client.close = () => {
          close();
          throw new Error("sqlite close failure");
        };
        return client;
      };
      await assert.rejects(createSnapshot(path.join(dir, "close-failed.db")), /sqlite close failure/);
      await assertNoPartialFiles(dir);
      assert.ok((await fs.stat(path.join(dir, "close-failed.db"))).size > 0, "A published backup survives a later close failure");
    } finally {
      mutableDatabase.openSqliteClient = originalClientFactory;
    }

    await fs.writeFile(path.join(dir, "backup_1999-01-01.db"), "expired backup");
    const [first, second] = await Promise.all([runBackup(), runBackup()]);
    assert.equal(first, second, "Concurrent backup requests share one completed snapshot");
    await assertRemoved(path.join(dir, "backup_1999-01-01.db"));
    assert.ok((await fs.stat(dbPath)).size > 0, "Retention must preserve a source DB with a backup-shaped name");
    assert.ok(!(await listBackupFiles()).some((file) => file.filename === path.basename(dbPath)));
    await assert.rejects(getBackupFile(path.basename(dbPath)), (error: unknown) => error instanceof HttpError && error.code === "NOT_FOUND");
    await assert.rejects(getBackupFile("../outside.db"), (error: unknown) => error instanceof HttpError && error.code === "BAD_REQUEST");

    const dbAlias = path.join(dir, "database-alias.db");
    await fs.symlink(dbPath, dbAlias);
    process.env.DATABASE_URL = `file:${dbAlias}`;
    try {
      assert.ok(!(await listBackupFiles()).some((file) => file.filename === path.basename(dbPath)), "A DB symlink target is excluded from the backup list");
      await assert.rejects(getBackupFile(path.basename(dbPath)), (error: unknown) => error instanceof HttpError && error.code === "NOT_FOUND");
      await runBackup();
      assert.ok((await fs.stat(dbPath)).size > 0, "Retention preserves the actual DB behind a symlink");
    } finally {
      process.env.DATABASE_URL = `file:${dbPath}`;
    }

    const current = await createCurrentSnapshot();
    const download = await openFileDownload(current);
    assert.equal(download.headers["Content-Length"], String((await fs.stat(current.filePath)).size));
    const reader = download.body.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      assert.ok(value.byteLength <= 64 * 1024, "Streaming has bounded chunks");
      chunks.push(value);
    }
    assert.equal(Buffer.concat(chunks).subarray(0, 16).toString(), "SQLite format 3\0");
    await assertRemoved(path.dirname(current.filePath));

    const cancelled = await createCurrentSnapshot();
    const cancelledDownload = await openFileDownload(cancelled);
    await cancelledDownload.body.cancel();
    await assertRemoved(path.dirname(cancelled.filePath));

    const abandoned = await createCurrentSnapshot();
    const responseFailure = new Error("response constructor failure");
    await assert.rejects(createFileDownloadResponse(abandoned, () => { throw responseFailure; }), (error: unknown) => error === responseFailure);
    await assertRemoved(path.dirname(abandoned.filePath));

    const missingDir = await fs.mkdtemp(path.join(dir, "missing-"));
    await assert.rejects(openFileDownload({
      filePath: path.join(missingDir, "missing.db"),
      filename: "missing.db",
      cleanup: () => fs.rm(missingDir, { recursive: true, force: true }),
    }), (error: unknown) => error instanceof HttpError && error.code === "NOT_FOUND");
    await assertRemoved(missingDir);

    const linkPath = path.join(dir, "download-link.db");
    await fs.symlink(dbPath, linkPath);
    await assert.rejects(openFileDownload({ filePath: linkPath, filename: "link.db" }), (error: unknown) => error instanceof HttpError && error.code === "NOT_FOUND");
    await assert.rejects(openFileDownload({ filePath: dbPath, filename: "bad\r\nheader.db" }), (error: unknown) => error instanceof HttpError && error.code === "BAD_REQUEST");

    let cleanupCalls = 0;
    const closeFailure = new Error("download close failure");
    try {
      fs.open = (async (...args: Parameters<typeof fs.open>) => {
        const handle = await originalOpen(...args);
        const close = handle.close.bind(handle);
        handle.close = async () => {
          await close();
          throw closeFailure;
        };
        return handle;
      }) as typeof fs.open;
      const failedDownload = await openFileDownload({
        filePath: snapshotPath,
        filename: "snapshot.db",
        cleanup: async () => { cleanupCalls++; },
      });
      await assert.rejects(failedDownload.body.cancel(), (error: unknown) => error === closeFailure);
      assert.equal(cleanupCalls, 1, "Temporary-resource cleanup runs even when closing the file fails");
    } finally {
      fs.open = originalOpen;
    }
    await assertNoPartialFiles(dir);
  } finally {
    source.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    await fs.rm(dir, { recursive: true, force: true });
  }
}
