import { NextResponse } from "next/server";
import { runBackup } from "@/lib/backup";

/**
 * POST /api/backup/trigger
 * 즉시 백업 실행
 */
export const POST = async () => {
  try {
    const dest = await runBackup();
    return NextResponse.json({ ok: true, path: dest });
  } catch (e) {
    const message = e instanceof Error ? e.message : "알 수 없는 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
};
