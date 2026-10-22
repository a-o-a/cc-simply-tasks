import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSqliteSnapshot } from "@/lib/backup";
import { getSqliteDbPath } from "@/lib/db";
import { HttpError, withErrorHandler } from "@/lib/http";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/backup
 * 커밋된 최신 변경을 포함하는 SQLite 스냅샷 다운로드.
 * 내부망 전용이므로 인증 없음.
 */
export const GET = withErrorHandler(async () => {
  const dbPath = getSqliteDbPath();

  if (!existsSync(dbPath)) {
    throw new HttpError("NOT_FOUND", "DB 파일을 찾을 수 없습니다");
  }

  const snapshotDir = await mkdtemp(path.join(tmpdir(), "cc-simply-tasks-backup-"));
  try {
    const snapshotPath = path.join(snapshotDir, "snapshot.db");
    await createSqliteSnapshot(snapshotPath);
    const file = await readFile(snapshotPath);
    const date = new Date().toISOString().slice(0, 10);

    return new NextResponse(new Uint8Array(file), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="backup-${date}.db"`,
        "Content-Length": String(file.byteLength),
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      },
    });
  } finally {
    await rm(snapshotDir, { recursive: true, force: true });
  }
});
