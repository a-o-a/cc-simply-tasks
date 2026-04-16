import { NextResponse } from "next/server";
import { listBackupFiles } from "@/lib/backup";

/**
 * GET /api/backup/files
 * 백업 파일 목록 반환 (최신순)
 */
export const GET = async () => {
  const files = listBackupFiles();
  return NextResponse.json({ files });
};
