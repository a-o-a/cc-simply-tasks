import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { getSqliteDbPath } from "@/lib/db";

/**
 * GET /api/backup
 * SQLite DB 파일을 그대로 다운로드.
 * 내부망 전용이므로 인증 없음.
 */
export const GET = async () => {
  const dbPath = getSqliteDbPath();

  if (!existsSync(dbPath)) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "DB 파일을 찾을 수 없습니다" } }, { status: 404 });
  }

  const file = readFileSync(dbPath);
  const date = new Date().toISOString().slice(0, 10);

  return new NextResponse(file, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="backup-${date}.db"`,
      "Content-Length": String(file.byteLength),
    },
  });
};
