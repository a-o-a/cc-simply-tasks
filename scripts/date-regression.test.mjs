import assert from "node:assert/strict";
import { test } from "node:test";
import { startTestServer } from "./test-server.mjs";

test("partial date updates validate the stored range", async (t) => {
  const { base } = await startTestServer(t);
  async function request(path, method = "GET", body) {
    const response = await fetch(`${base}${path}`, {
      method, headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }
  const start = "2026-10-22T09:00:00+09:00";
  const end = "2026-10-22T10:00:00+09:00";
  for (const [resource, startKey, endKey, allowEqual] of [
    ["work-items", "startDate", "endDate", true],
    ["calendar-events", "startDateTime", "endDateTime", false],
  ]) {
    await t.test(`${resource}: single-ended updates and rollback`, async () => {
      const created = await request(`/api/${resource}`, "POST", { title: "날짜 검수", [startKey]: start, [endKey]: end });
      assert.equal(created.status, 201);
      const path = `/api/${resource}/${created.body.id}`;
      for (const patch of [
        { [startKey]: "2026-10-23T09:00:00+09:00" },
        { [endKey]: "2026-10-21T10:00:00+09:00" },
      ]) {
        const result = await request(path, "PATCH", patch);
        assert.equal(result.status, 400, JSON.stringify(result));
        assert.equal(result.body.error.code, "VALIDATION_ERROR");
        const unchanged = (await request(path)).body;
        assert.equal(unchanged[startKey], created.body[startKey]);
        assert.equal(unchanged[endKey], created.body[endKey]);
      }
      assert.equal((await request(path, "PATCH", { [endKey]: start })).status, allowEqual ? 200 : 400);
      if (allowEqual) assert.equal((await request(path, "PATCH", { [startKey]: null })).status, 200);
      assert.equal((await request(path, "PATCH", { [endKey]: "2026-10-23T10:00:00+09:00" })).status, 200);
    });
  }
  await t.test("nonexistent dates and reversed filter ranges return 400", async () => {
    for (const path of [
      "/api/work-items?transferDate=2026-02-30",
      "/api/todos?dueDateFrom=2026-99-99",
      "/api/work-items?transferDate=2026-10-24&transferDateTo=2026-10-22",
      "/api/todos?dueDateFrom=2026-10-24&dueDateTo=2026-10-22",
      "/api/calendar-events?from=2026-10-24T00:00:00Z&to=2026-10-22T00:00:00Z",
    ]) assert.equal((await request(path)).status, 400, path);
  });
});
