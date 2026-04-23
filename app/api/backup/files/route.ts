import { NextResponse } from "next/server";
import { listBackupFiles } from "@/lib/backup";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/backup/files
 * 백업 파일 목록 반환 (최신순)
 */
export const GET = async () => {
  const files = listBackupFiles();
  return NextResponse.json(
    { files },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      },
    },
  );
};
