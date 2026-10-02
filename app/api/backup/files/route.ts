import { NextResponse } from "next/server";
import { listBackupFiles } from "@/lib/backup";
import { withErrorHandler } from "@/lib/http";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const GET = withErrorHandler(async () => NextResponse.json(
  { files: await listBackupFiles() },
  { headers: { "Cache-Control": "no-store" } },
));
