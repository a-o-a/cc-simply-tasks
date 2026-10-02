import { NextResponse } from "next/server";
import { getBackupFile } from "@/lib/backup";
import { createFileDownloadResponse } from "@/lib/file-download";
import { withErrorHandler } from "@/lib/http";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const GET = withErrorHandler(async (
  _request: Request,
  { params: paramsPromise }: { params: Promise<{ filename: string }> },
) => {
  const params = await paramsPromise;
  return createFileDownloadResponse(await getBackupFile(params.filename), ({ body, headers }) => new NextResponse(body, { headers }));
});
