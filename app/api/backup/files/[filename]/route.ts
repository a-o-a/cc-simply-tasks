import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { getSqliteDbPath } from "@/lib/db";

/**
 * GET /api/backup/files/:filename
 * 특정 백업 파일 다운로드
 */
export const GET = async (
  _req: Request,
  { params }: { params: { filename: string } }
) => {
  const { filename } = params;

  // 경로 탐색 공격 방지: 파일명만 허용
  if (!/^backup_\d{4}-\d{2}-\d{2}\.db$/.test(filename)) {
    return NextResponse.json({ error: "잘못된 파일명입니다" }, { status: 400 });
  }

  const dir = path.dirname(getSqliteDbPath());
  const filePath = path.join(dir, filename);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "파일을 찾을 수 없습니다" }, { status: 404 });
  }

  const file = fs.readFileSync(filePath);

  return new NextResponse(file, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(file.byteLength),
    },
  });
};
