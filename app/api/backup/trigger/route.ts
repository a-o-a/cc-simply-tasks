import path from "path";
import { NextResponse } from "next/server";
import { runBackup } from "@/lib/backup";
import { withErrorHandler } from "@/lib/http";

export const POST = withErrorHandler(async (_request: Request) => {
  const destination = await runBackup();
  return NextResponse.json({ ok: true, filename: path.basename(destination) });
});
