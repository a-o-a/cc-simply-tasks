import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client/node";
import { startTestServer } from "./test-server.mjs";

// Edge cases for SQL cursor paging, including nullable transfer dates and
// millisecond boundaries. Writes only target the test server's temporary DB.
test("bounded cursor pages preserve filters, ties and date boundaries", { timeout: 60_000 }, async (t) => {
  const { directory, base, serverLog } = await startTestServer(t);
  const sqlite = createClient({ url: pathToFileURL(path.join(directory, "smoke.db")).href });
  t.after(() => sqlite.close());
  const timestamp = Date.parse("2026-10-28T00:00:00+09:00");
  await sqlite.batch(Array.from({ length: 83 }, (_, i) => ({
    sql: 'INSERT INTO WorkItem(id,title,category,status,"order",transferDate,createdAt,updatedAt,deletedAt) VALUES(?,?,?,?,?,?,?,?,?)',
    args: [`work-${String(i).padStart(3, "0")}`, `cursor work ${i}`, i % 2 ? "odd" : "even", "TRANSFERRED", i % 4, i % 3 ? timestamp + (i % 7) : null, timestamp + Math.floor(i / 4), timestamp, i === 82 ? timestamp : null],
  })), "write");
  await sqlite.batch(Array.from({ length: 83 }, (_, i) => ({
    sql: 'INSERT INTO Todo(id,title,status,"order",createdAt,updatedAt,deletedAt) VALUES(?,?,?,?,?,?,?)',
    args: [`todo-${String(i).padStart(3, "0")}`, `cursor todo ${i}`, i % 2 ? "OPEN" : "DONE", i % 4, timestamp + Math.floor(i / 4), timestamp, i === 82 ? timestamp : null],
  })), "write");
  await sqlite.batch(Array.from({ length: 83 }, (_, i) => ({
    sql: 'INSERT INTO AuditLog(id,entityType,entityId,action,actorName,createdAt) VALUES(?,?,?,?,?,?)',
    args: [`audit-${String(i).padStart(3, "0")}`, "WorkItem", `work-${i}`, "UPDATE", i % 2 ? "odd" : "even", timestamp + Math.floor(i / 4)],
  })), "write");

  async function get(route, status = 200) {
    const response = await fetch(`${base}${route}`);
    const data = await response.json();
    assert.equal(response.status, status, `${route}: ${JSON.stringify(data).slice(0, 800)}\n${serverLog()}`);
    return data;
  }
  const routes = [
    "/api/work-items?scope=all", "/api/work-items?scope=transferred", "/api/work-items?scope=transferred&category=odd",
    "/api/todos?status=OPEN", "/api/audit-logs?actorName=odd",
  ];
  await t.test("all cursor pages match full ordering, including NULL transfer dates and tied timestamps", async () => {
    for (const route of routes) {
      const complete = await get(`${route}&pageSize=200`);
      for (const size of [1, 7, 50]) {
        const seen = [];
        let cursor;
        do {
          const page = await get(`${route}&pageSize=${size}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
          assert.ok(page.items.length <= size);
          seen.push(...page.items.map((row) => row.id));
          assert.ok(seen.length <= complete.items.length, "cursor paging must advance");
          cursor = page.nextCursor;
        } while (cursor);
        assert.deepEqual(seen, complete.items.map((row) => row.id), `${route}, pageSize=${size}`);
      }
      const last = complete.items.at(-1).id;
      assert.deepEqual(await get(`${route}&cursor=${last}`), { items: [], nextCursor: null }, "a valid final cursor is not a missing cursor");
    }
  });
  await t.test("missing, soft-deleted and filtered-out anchors remain recoverable 400 errors", async () => {
    for (const route of routes) {
      assert.equal((await get(`${route}&cursor=absent`, 400)).error.code, "BAD_REQUEST");
    }
    for (const route of [
      "/api/work-items?scope=transferred&cursor=work-082", "/api/todos?cursor=todo-082",
      "/api/work-items?scope=transferred&category=odd&cursor=work-002", "/api/todos?status=OPEN&cursor=todo-002",
      "/api/audit-logs?actorName=odd&cursor=audit-002",
    ]) assert.equal((await get(route, 400)).error.code, "BAD_REQUEST");
  });
  await t.test("a cursor moved to another sort group uses its current position", async () => {
    await sqlite.execute({ sql: 'UPDATE WorkItem SET transferDate=NULL WHERE id=?', args: ["work-011"] });
    const all = await get("/api/work-items?scope=transferred&pageSize=200");
    const index = all.items.findIndex((row) => row.id === "work-011");
    const next = await get("/api/work-items?scope=transferred&cursor=work-011&pageSize=7");
    assert.deepEqual(next.items.map((row) => row.id), all.items.slice(index + 1, index + 8).map((row) => row.id));
  });

  const times = ["2026-10-31T23:59:59.000+09:00", "2026-10-31T23:59:59.001+09:00", "2026-10-31T23:59:59.999+09:00", "2026-11-01T00:00:00.000+09:00"];
  for (const [i, time] of times.entries()) {
    await sqlite.execute({ sql: "INSERT INTO WorkItem(id,title,status,transferDate,createdAt,updatedAt) VALUES(?,?,?,?,?,?)", args: [`boundary-work-${i}`, "date boundary work", "WAITING", Date.parse(time), timestamp, timestamp] });
    await sqlite.execute({ sql: "INSERT INTO Todo(id,title,dueDate,createdAt,updatedAt) VALUES(?,?,?,?,?)", args: [`boundary-todo-${i}`, "date boundary todo", Date.parse(time), timestamp, timestamp] });
  }
  await t.test("transfer date's inclusive final day includes its final 999 milliseconds", async () => {
    const result = await get("/api/work-items?transferDate=2026-10-31&transferDateTo=2026-10-31");
    assert.deepEqual(result.items.map((row) => row.id).sort(), ["boundary-work-0", "boundary-work-1", "boundary-work-2"]);
  });
  await t.test("TODO date filter and count both include the final millisecond, excluding next midnight", async () => {
    const query = "dueDateFrom=2026-10-31&dueDateTo=2026-10-31";
    const result = await get(`/api/todos?${query}`);
    assert.deepEqual(result.items.map((row) => row.id).sort(), ["boundary-todo-0", "boundary-todo-1", "boundary-todo-2"]);
    assert.equal((await get(`/api/todos/count?${query}`)).count, 3);
  });
});
