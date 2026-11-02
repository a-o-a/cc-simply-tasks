import { NextResponse } from "next/server";
import { createCurrentSnapshot } from "@/lib/backup";
import { createFileDownloadResponse } from "@/lib/file-download";
import { withErrorHandler } from "@/lib/http";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Download a consistent snapshot, including committed changes still in the WAL. */
export const GET = withErrorHandler(async () => {
  return createFileDownloadResponse(await createCurrentSnapshot(), ({ body, headers }) => new NextResponse(body, { headers }));
});
