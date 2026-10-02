import assert from "assert/strict";
import fs from "fs/promises";
import { openFileDownload } from "../lib/file-download";

type TestHandle = {
  read: () => Promise<{ bytesRead: number }>;
  close: () => Promise<void>;
};

async function withTestHandle(handle: TestHandle, run: () => Promise<void>) {
  const originalOpen = fs.open;
  fs.open = (async () => ({ ...handle, stat: async () => ({ isFile: () => true, size: 0 }) })) as unknown as typeof fs.open;
  try {
    await run();
  } finally {
    fs.open = originalOpen;
  }
}

export async function runFileDownloadTests() {
  const closeFailure = new Error("close failed at EOF");
  let cleanupCalls = 0;
  await withTestHandle({
    read: async () => ({ bytesRead: 0 }),
    close: async () => { throw closeFailure; },
  }, async () => {
    const download = await openFileDownload({
      filePath: "/test.db",
      filename: "test.db",
      cleanup: async () => { cleanupCalls++; },
    });
    await assert.rejects(download.body.getReader().read(), (error: unknown) => error === closeFailure);
    assert.equal(cleanupCalls, 1, "EOF reports close failure after the resource cleanup runs");
  });

  const readFailure = new Error("read failed");
  const cleanupFailure = new Error("cleanup failed");
  let closes = 0;
  cleanupCalls = 0;
  await withTestHandle({
    read: async () => { throw readFailure; },
    close: async () => { closes++; },
  }, async () => {
    const download = await openFileDownload({
      filePath: "/test.db",
      filename: "test.db",
      cleanup: async () => { cleanupCalls++; throw cleanupFailure; },
    });
    await assert.rejects(download.body.getReader().read(), (error: unknown) => error === readFailure);
    assert.equal(closes, 1);
    assert.equal(cleanupCalls, 1, "A cleanup failure must not replace the original read error");
  });

  let notifyCleanup!: () => void;
  let finishCleanup!: () => void;
  const cleanupStarted = new Promise<void>((resolve) => { notifyCleanup = resolve; });
  const cleanupFinished = new Promise<void>((resolve) => { finishCleanup = resolve; });
  closes = 0;
  cleanupCalls = 0;
  await withTestHandle({
    read: async () => ({ bytesRead: 0 }),
    close: async () => { closes++; },
  }, async () => {
    const download = await openFileDownload({
      filePath: "/test.db",
      filename: "test.db",
      cleanup: async () => {
        cleanupCalls++;
        notifyCleanup();
        await cleanupFinished;
      },
    });
    const reader = download.body.getReader();
    const read = reader.read();
    await cleanupStarted;
    let cancellationFinished = false;
    const cancel = reader.cancel().then(() => { cancellationFinished = true; });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(cancellationFinished, false, "Cancellation waits for an already-running EOF cleanup");
    } finally {
      finishCleanup();
    }
    await cancel;
    assert.equal((await read).done, true);
    assert.equal(closes, 1);
    assert.equal(cleanupCalls, 1, "EOF and cancellation share the same disposal promise");
  });
}
