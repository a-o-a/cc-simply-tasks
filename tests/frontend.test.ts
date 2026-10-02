import assert from "assert/strict";
import { api, ApiError, isAbortError } from "../lib/client/api";

function jsonResponse(value: unknown): Response {
  return { ok: true, status: 200, text: async () => JSON.stringify(value) } as Response;
}

export async function runFrontendTests() {
  const originalFetch = globalThis.fetch;
  try {
    const controller = new AbortController();
    const requests: URL[] = [];
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input), "http://localhost");
      requests.push(url);
      assert.equal(init?.signal, controller.signal);
      assert.equal(url.searchParams.get("status"), "OPEN");
      assert.equal(url.searchParams.get("pageSize"), "100");
      return url.searchParams.has("cursor")
        ? jsonResponse({ items: [{ id: "second" }], nextCursor: null })
        : jsonResponse({ items: [{ id: "first" }], nextCursor: "next-page" });
    };
    const items = await api.getAllPages<{ id: string }>("/api/todos", {
      query: { status: "OPEN" }, signal: controller.signal,
    });
    assert.deepEqual(items.map((item) => item.id), ["first", "second"]);
    assert.equal(requests.length, 2);
    assert.equal(requests[1].searchParams.get("cursor"), "next-page");

    let repetitions = 0;
    globalThis.fetch = async () => {
      repetitions += 1;
      return jsonResponse({ items: [{ id: "same" }], nextCursor: "unchanged" });
    };
    await assert.rejects(api.getAllPages("/api/work-items"), (error: unknown) => error instanceof ApiError && error.code === "BAD_RESPONSE");
    assert.equal(repetitions, 2, "A repeated cursor must stop instead of requesting forever or returning a partial list");

    const abort = new Error("cancelled");
    abort.name = "AbortError";
    globalThis.fetch = async () => { throw abort; };
    await assert.rejects(api.getAllPages("/api/work-items"), (error: unknown) => error === abort && isAbortError(error));

    const cancelled = new AbortController();
    cancelled.abort();
    let cancelledFetches = 0;
    globalThis.fetch = async () => { cancelledFetches += 1; return jsonResponse({ items: [], nextCursor: null }); };
    await assert.rejects(api.getAllPages("/api/work-items", { signal: cancelled.signal }), isAbortError);
    assert.equal(cancelledFetches, 0, "A cancelled screen must not start another fetch");

    const cancelledBetweenPages = new AbortController();
    let fetchedPages = 0;
    globalThis.fetch = async () => {
      fetchedPages += 1;
      cancelledBetweenPages.abort();
      return jsonResponse({ items: [{ id: "partial" }], nextCursor: "next" });
    };
    await assert.rejects(api.getAllPages("/api/work-items", { signal: cancelledBetweenPages.signal }), isAbortError);
    assert.equal(fetchedPages, 1, "Aborting a multi-page load must not request or return the next page");

    globalThis.fetch = async () => jsonResponse({ unexpected: [] });
    await assert.rejects(api.getAllPages("/api/work-items"), (error: unknown) => error instanceof ApiError && error.code === "BAD_RESPONSE");
  } finally {
    globalThis.fetch = originalFetch;
  }
}
