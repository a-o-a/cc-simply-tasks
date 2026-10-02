import fs from "fs/promises";
import { constants } from "fs";
import { ReadableStream as NodeReadableStream } from "stream/web";
import { HttpError } from "./errors";

export interface DownloadFile {
  filePath: string;
  filename: string;
  cleanup?: () => Promise<void>;
}

export interface FileDownload {
  body: ReadableStream<Uint8Array>;
  headers: Record<string, string>;
}

/** Transfer stream ownership to a response, or dispose it if constructing that response fails. */
export async function createFileDownloadResponse<T>(
  resource: DownloadFile,
  createResponse: (download: FileDownload) => T | Promise<T>,
): Promise<T> {
  const download = await openFileDownload(resource);
  try {
    return await createResponse(download);
  } catch (error) {
    await download.body.cancel().catch(() => undefined);
    throw error;
  }
}

/** Owns the file handle and optional temporary resource until EOF or cancellation. */
export async function openFileDownload(resource: DownloadFile): Promise<FileDownload> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  let disposed = false;
  let cancelled = false;
  let disposePromise: Promise<void> | undefined;
  const dispose = () => {
    if (!disposePromise) {
      disposed = true;
      disposePromise = (async () => {
        try {
          await handle?.close();
        } finally {
          await resource.cleanup?.();
        }
      })();
    }
    return disposePromise;
  };

  try {
    if (!resource.filename || /[^\x20-\x7e]|["\\/]/.test(resource.filename)) {
      throw new HttpError("BAD_REQUEST", "잘못된 다운로드 파일명입니다");
    }
    handle = await fs.open(resource.filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await handle.stat();
    if (!stat.isFile()) throw new HttpError("NOT_FOUND", "파일을 찾을 수 없습니다");
    const file = handle;
    // Services and standalone tests use the same Node Web Streams implementation.
    const stream = new NodeReadableStream<Uint8Array>({
      async pull(controller) {
        if (disposed) return;
        try {
          const buffer = Buffer.allocUnsafe(64 * 1024);
          const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
          if (disposed) return;
          if (bytesRead === 0) {
            await dispose();
            if (!cancelled) controller.close();
          } else {
            controller.enqueue(new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead));
          }
        } catch (error) {
          // Report the original stream error after resource disposal has settled.
          await dispose().catch(() => undefined);
          if (!cancelled) controller.error(error);
        }
      },
      async cancel() {
        cancelled = true;
        await dispose();
      },
    });
    return {
      body: stream as unknown as ReadableStream<Uint8Array>,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${resource.filename}"`,
        "Content-Length": String(stat.size),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    };
  } catch (error) {
    await dispose();
    if (["ENOENT", "ELOOP", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) {
      throw new HttpError("NOT_FOUND", "파일을 찾을 수 없습니다");
    }
    throw error;
  }
}
