import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client/node";
import { startTestServer } from "./test-server.mjs";

// Run after `npm run build`: node --test scripts/smoke.test.mjs
const actorName = "기능 점검";
const startDate = "2026-10-15T09:00:00+09:00";
const endDate = "2026-10-15T10:00:00+09:00";

test("production application smoke tests (isolated SQLite database)", { timeout: 120_000 }, async (t) => {
  const { directory, base, serverLog } = await startTestServer(t);

  let requestCount = 0;
  async function request(route, { method = "GET", body, status = 200, binary = false } = {}) {
    requestCount += 1;
    const response = await fetch(`${base}${route}`, {
      method,
      headers: { "Content-Type": "application/json", "x-actor-name": encodeURIComponent(actorName) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, status, `${method} ${route}: ${bytes.toString().slice(0, 2_000)}\n${serverLog()}`);
    return {
      response,
      data: binary ? bytes : bytes.length ? JSON.parse(bytes.toString()) : null,
    };
  }
  const get = async (route) => (await request(route)).data;
  const post = async (route, body) => (await request(route, { method: "POST", body, status: 201 })).data;
  const patch = async (route, body) => (await request(route, { method: "PATCH", body })).data;
  const remove = async (route) => request(route, { method: "DELETE", status: 204 });
  const error = async (route, method, body, status, code) => {
    const result = await request(route, { method, body, status });
    if (code) assert.equal(result.data.error.code, code);
    if (code === "VALIDATION_ERROR") {
      assert.ok(Array.isArray(result.data.error.details.formErrors));
      assert.equal(typeof result.data.error.details.fieldErrors, "object");
    }
    return result.data;
  };

  // Fail early if test setup ever starts reading a seeded or user database.
  assert.ok((await get("/api/db-stats")).tables.every((table) => table.count === 0));
  const member = await post("/api/team-members", { name: "검증 담당자", role: "WEB_DEV" });
  const category = await post("/api/work-categories", { code: "smoke", name: "검증 분류" });
  const system = await post("/api/work-systems", { code: "smoke", name: "검증 시스템" });

  await t.test("all application pages and their JavaScript assets are served", async () => {
    for (const route of ["/", "/work-items", "/todos", "/members", "/calendar", "/transfer", "/settings"]) {
      const { response, data } = await request(route, { binary: true });
      assert.match(response.headers.get("content-type"), /text\/html/);
      const html = data.toString();
      assert.match(html, /<!DOCTYPE html>/i);
      assert.doesNotMatch(html, /Application error: a server-side exception/);
      const script = html.match(/<script[^>]+src="([^"]+\.js(?:\?[^"]*)?)"/);
      assert.ok(script, `${route} has no JavaScript bundle`);
      const asset = await request(script[1].replaceAll("&amp;", "&"), { binary: true });
      assert.ok(asset.data.length > 0);
    }
  });

  await t.test("team members, categories and systems support CRUD and restore", async () => {
    const temporaryMember = await post("/api/team-members", { name: "수정 전", role: "ETC" });
    assert.equal((await patch(`/api/team-members/${temporaryMember.id}`, { name: "수정 후", role: "APP_DEV" })).name, "수정 후");
    assert.equal((await get(`/api/team-members/${temporaryMember.id}`)).role, "APP_DEV");
    assert.ok((await get("/api/team-members?role=APP_DEV")).items.some((item) => item.id === temporaryMember.id));
    await remove(`/api/team-members/${temporaryMember.id}`);
    await error(`/api/team-members/${temporaryMember.id}`, "GET", undefined, 404, "NOT_FOUND");
    assert.ok(!(await get("/api/team-members")).items.some((item) => item.id === temporaryMember.id));

    for (const endpoint of ["work-categories", "work-systems"]) {
      const created = await post(`/api/${endpoint}`, { code: "temporary", name: "임시" });
      assert.equal((await patch(`/api/${endpoint}/${created.id}`, { name: "이름 변경" })).name, "이름 변경");
      assert.ok((await get(`/api/${endpoint}`)).items.some((item) => item.id === created.id));
      await remove(`/api/${endpoint}/${created.id}`);
      assert.ok(!(await get(`/api/${endpoint}`)).items.some((item) => item.id === created.id));
      const restored = await post(`/api/${endpoint}`, { code: "temporary", name: "복원" });
      assert.equal(restored.id, created.id);
      assert.equal(restored.deletedAt, null);
      await remove(`/api/${endpoint}/${restored.id}`);
    }
  });

  await t.test("work items, ticket replacement, bulk status and transfer filters", async () => {
    const initialCount = (await get("/api/work-items/count")).total;
    const work = await post("/api/work-items", {
      title: "업그레이드 작업", category: category.code, assigneeId: member.id,
      priority: "HIGH", startDate, endDate, requestNumber: "REQ-101",
      tickets: [{ systemName: system.code, ticketNumber: "SMOKE-101" }],
    });
    const second = await post("/api/work-items", { title: "업그레이드 작업 2" });
    const detail = await get(`/api/work-items/${work.id}`);
    assert.equal(detail.assignee.id, member.id);
    assert.equal(detail.tickets[0].ticketNumber, "SMOKE-101");
    const filters = new URLSearchParams({ title: "업그레이드", assigneeId: member.id, category: category.code, priority: "HIGH", ticket: "SMOKE-101", systemCode: system.code });
    assert.deepEqual((await get(`/api/work-items?${filters}`)).items.map((item) => item.id), [work.id]);
    const firstPage = await get("/api/work-items?pageSize=1");
    assert.equal(firstPage.items.length, 1);
    assert.ok(firstPage.nextCursor);
    const nextPage = await get(`/api/work-items?pageSize=1&cursor=${firstPage.nextCursor}`);
    assert.equal(nextPage.items.length, 1);
    assert.notEqual(nextPage.items[0].id, firstPage.items[0].id);

    await patch(`/api/work-items/${work.id}`, { description: "수정된 설명", tickets: [{ systemName: system.code, ticketNumber: "SMOKE-102" }] });
    const replaced = await get(`/api/work-items/${work.id}`);
    assert.equal(replaced.description, "수정된 설명");
    assert.deepEqual(replaced.tickets.map((ticket) => ticket.ticketNumber), ["SMOKE-102"]);
    assert.equal((await get("/api/work-items?ticket=SMOKE-101")).items.length, 0);

    const bulk = await request("/api/work-items/bulk-status", { method: "POST", body: { ids: [work.id, second.id, work.id], status: "TRANSFER_READY" } });
    assert.equal(bulk.data.updatedCount, 2);
    const skipped = await request("/api/work-items/bulk-status", { method: "POST", body: { ids: [work.id], status: "TRANSFER_READY" } });
    assert.equal(skipped.data.updatedCount, 0);
    assert.deepEqual(skipped.data.skippedIds, [work.id]);
    await patch(`/api/work-items/${work.id}`, { status: "TRANSFERRED", transferDate: startDate });
    const transferred = await get("/api/work-items?scope=transferred&hasTransferDate=true&transferDate=2026-10-15&transferDateTo=2026-10-15");
    assert.deepEqual(transferred.items.map((item) => item.id), [work.id]);
    assert.ok(!(await get("/api/work-items?scope=active")).items.some((item) => item.id === work.id));
    const counts = await request("/api/work-items/count");
    assert.equal(counts.data.total, initialCount + 2);
    assert.equal(counts.data.byStatus.TRANSFERRED, 1);
    assert.match(counts.response.headers.get("cache-control"), /no-store/);
    await remove(`/api/work-items/${work.id}`);
    await remove(`/api/work-items/${second.id}`);
    await error(`/api/work-items/${work.id}`, "GET", undefined, 404, "NOT_FOUND");
    assert.equal((await get("/api/work-items/count")).total, initialCount);
  });

  await t.test("concurrent work writes commit their data and audit logs together", async () => {
    const initialCount = (await get("/api/work-items/count")).total;
    const created = await Promise.all(Array.from({ length: 8 }, (_, index) =>
      post("/api/work-items", { title: `동시 쓰기 ${index + 1}`, assigneeId: member.id })));
    assert.equal(new Set(created.map((item) => item.id)).size, 8);
    assert.equal((await get("/api/work-items/count")).total, initialCount + 8);
    await Promise.all(created.map(async (item) => {
      const [detail, audit] = await Promise.all([
        get(`/api/work-items/${item.id}`),
        get(`/api/audit-logs?entityType=WorkItem&entityId=${item.id}&action=CREATE`),
      ]);
      assert.equal(detail.title, item.title);
      assert.equal(detail.assignee.id, member.id);
      assert.equal(audit.items.length, 1);
      assert.equal(audit.items[0].actorName, actorName);
      assert.equal(JSON.parse(audit.items[0].afterJson).title, item.title);
    }));
    await Promise.all(created.map((item) => remove(`/api/work-items/${item.id}`)));
    assert.equal((await get("/api/work-items/count")).total, initialCount);
  });

  await t.test("todos, checklist assignment/completion/reorder/deletion and counts", async () => {
    const todo = await post("/api/todos", {
      title: "검증 할 일", assigneeId: member.id, dueDate: startDate,
      checklist: [{ content: "첫 항목", assigneeId: member.id }, { content: "둘째 항목", order: 1 }],
    });
    assert.equal(todo.status, "OPEN");
    assert.equal(todo.assignee.id, member.id);
    assert.equal(todo.checklist.length, 2);
    const first = todo.checklist[0];
    const second = todo.checklist[1];
    assert.equal(first.assignee.id, member.id);
    const added = await post(`/api/todos/${todo.id}/checklist`, { content: "추가 항목", order: 2 });
    assert.equal((await patch(`/api/todos/${todo.id}/checklist/${first.id}`, { done: true })).done, true);
    await request(`/api/todos/${todo.id}/checklist`, { method: "PATCH", body: { ids: [added.id, second.id, first.id] }, status: 204 });
    assert.deepEqual((await get(`/api/todos/${todo.id}`)).checklist.map((item) => item.id), [added.id, second.id, first.id]);
    const query = new URLSearchParams({ status: "OPEN", assigneeId: member.id, dueDateFrom: "2026-10-15", dueDateTo: "2026-10-15", include: "checklist" });
    const listed = await get(`/api/todos?${query}`);
    assert.equal(listed.items[0].checklist.length, 3);
    assert.equal((await get(`/api/todos/count?${query}`)).count, 1);
    await remove(`/api/todos/${todo.id}/checklist/${added.id}`);
    assert.equal((await get(`/api/todos/${todo.id}`)).checklist.length, 2);
    await patch(`/api/todos/${todo.id}`, { title: "완료한 할 일", status: "DONE", note: "완료 메모" });
    assert.equal((await get(`/api/todos/count?${query}`)).count, 0);
    assert.equal((await get("/api/todos/count?status=DONE")).count, 1);
    await remove(`/api/todos/${todo.id}`);
    await error(`/api/todos/${todo.id}`, "GET", undefined, 404, "NOT_FOUND");
    await error(`/api/todos/${todo.id}/checklist/${first.id}`, "PATCH", { done: false }, 404, "NOT_FOUND");
    assert.equal((await get("/api/todos/count")).count, 0);
  });

  await t.test("calendar events preserve members, date ranges and soft deletion", async () => {
    const event = await post("/api/calendar-events", { title: "업그레이드 점검", category: "WORK", startDateTime: startDate, endDateTime: endDate, memberIds: [member.id] });
    assert.equal((await get(`/api/calendar-events/${event.id}`)).members[0].memberId, member.id);
    const range = new URLSearchParams({ from: startDate, to: endDate, memberId: member.id });
    assert.deepEqual((await get(`/api/calendar-events?${range}`)).items.map((item) => item.id), [event.id]);
    const adjacent = new URLSearchParams({ from: endDate, to: "2026-10-15T11:00:00+09:00" });
    assert.equal((await get(`/api/calendar-events?${adjacent}`)).items.length, 0);
    const updated = await patch(`/api/calendar-events/${event.id}`, { title: "점검 완료", memberIds: [], allDay: true });
    assert.equal(updated.title, "점검 완료");
    assert.deepEqual(updated.members, []);
    assert.equal(updated.allDay, true);
    assert.equal((await get(`/api/calendar-events?${range}`)).items.length, 0);
    await remove(`/api/calendar-events/${event.id}`);
    await error(`/api/calendar-events/${event.id}`, "GET", undefined, 404, "NOT_FOUND");
  });

  await t.test("calendar changes reach an open server-sent event stream", async () => {
    const event = await post("/api/calendar-events", { title: "실시간 갱신", startDateTime: startDate, endDateTime: endDate });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    let streamResponse;
    let streamError;
    const connection = fetch(`${base}/api/calendar-events/stream`, { signal: controller.signal })
      .then((response) => { streamResponse = response; }, (cause) => { streamError = cause; });
    try {
      // This stream sends headers with its first event. Retry a real edit while
      // the connection starts instead of assuming a fixed server startup delay.
      for (let attempt = 0; attempt < 30 && !streamResponse && !streamError; attempt += 1) {
        await delay(100);
        await patch(`/api/calendar-events/${event.id}`, { note: `갱신 ${attempt}` });
      }
      assert.ifError(streamError);
      assert.ok(streamResponse, "Calendar edits did not deliver a stream response");
      assert.equal(streamResponse.status, 200);
      assert.match(streamResponse.headers.get("content-type"), /text\/event-stream/);
      const reader = streamResponse.body.getReader();
      let payload = "";
      while (!payload.includes("data: refresh")) {
        const part = await reader.read();
        assert.equal(part.done, false, "Calendar stream ended before its refresh event");
        payload += new TextDecoder().decode(part.value);
      }
      await reader.cancel();
    } finally {
      clearTimeout(timeout);
      controller.abort();
      await connection;
      await remove(`/api/calendar-events/${event.id}`);
    }
  });

  await t.test("settings update immediately and audit logs retain actor and before/after data", async () => {
    assert.equal((await patch("/api/settings", { service_name: "기능 점검 서비스" })).service_name, "기능 점검 서비스");
    assert.equal((await get("/api/settings")).service_name, "기능 점검 서비스");
    const work = await post("/api/work-items", { title: "감사 로그 점검" });
    await patch(`/api/work-items/${work.id}`, { title: "감사 로그 수정" });
    await remove(`/api/work-items/${work.id}`);
    const query = new URLSearchParams({ entityType: "WorkItem", entityId: work.id, actorName });
    const logs = await get(`/api/audit-logs?${query}`);
    assert.equal(logs.items.length, 3);
    assert.deepEqual(new Set(logs.items.map((item) => item.action)), new Set(["CREATE", "UPDATE", "DELETE"]));
    assert.ok(logs.items.every((item) => item.actorName === actorName));
    const updated = logs.items.find((item) => item.action === "UPDATE");
    assert.equal(JSON.parse(updated.beforeJson).title, "감사 로그 점검");
    assert.equal(JSON.parse(updated.afterJson).title, "감사 로그 수정");
    const stats = await get("/api/db-stats");
    assert.equal(stats.tables.length, 11);
    assert.ok(stats.tables.find((item) => item.name === "AuditLog").count >= 3);
    assert.ok(stats.tables.find((item) => item.name === "WorkItem").count > (await get("/api/work-items/count")).total);
  });

  await t.test("invalid input and missing resources return structured client errors", async () => {
    for (const route of ["/api/work-items", "/api/todos", "/api/team-members"]) {
      await error(route, "POST", { title: "", name: "", role: "INVALID" }, 400, "VALIDATION_ERROR");
    }
    await error("/api/work-items", "POST", { title: "날짜 역전", startDate: endDate, endDate: startDate }, 400, "VALIDATION_ERROR");
    await error("/api/calendar-events", "POST", { title: "날짜 역전", startDateTime: endDate, endDateTime: startDate }, 400, "VALIDATION_ERROR");
    await error("/api/todos", "POST", { title: "빈 체크리스트", checklist: [{ content: "" }] }, 400, "VALIDATION_ERROR");
    await error("/api/work-items?pageSize=0", "GET", undefined, 400, "VALIDATION_ERROR");
    await error("/api/calendar-events", "GET", undefined, 400, "VALIDATION_ERROR");
    await error("/api/settings", "PATCH", { service_name: "" }, 400, "VALIDATION_ERROR");
    await error("/api/work-categories", "POST", { code: "공백 불가", name: "잘못된 분류" }, 400, "VALIDATION_ERROR");
    await error("/api/work-items/bulk-status", "POST", { ids: [], status: "WAITING" }, 400, "VALIDATION_ERROR");
    await error("/api/work-items/bulk-status", "POST", { ids: ["missing"], status: "WAITING" }, 404, "NOT_FOUND");
    await error("/api/todos/missing/checklist", "POST", { content: "없는 부모" }, 404, "NOT_FOUND");
    await error("/api/work-items/missing", "PATCH", { title: "없는 작업" }, 404, "NOT_FOUND");
    const conflictingSystem = await post("/api/work-systems", { code: "conflict-target", name: "중복 검증" });
    await error(`/api/work-systems/${conflictingSystem.id}`, "PATCH", { code: system.code }, 409, "CONFLICT");
    assert.equal((await get("/api/work-systems")).items.find((item) => item.id === conflictingSystem.id).code, "conflict-target");
    await remove(`/api/work-systems/${conflictingSystem.id}`);
  });

  await t.test("manual and direct backups contain the latest data and pass SQLite integrity checks", async () => {
    const marker = await post("/api/work-items", { title: "WAL 포함 백업 검증" });
    const triggered = await request("/api/backup/trigger", { method: "POST" });
    assert.equal(triggered.data.ok, true);
    assert.equal(path.dirname(triggered.data.path), directory);
    const files = await request("/api/backup/files");
    assert.match(files.response.headers.get("cache-control"), /no-store/);
    assert.ok(files.data.files.length >= 1);
    const filename = path.basename(triggered.data.path);
    assert.ok(files.data.files.some((file) => file.filename === filename && file.size > 0));

    for (const [index, route] of [`/api/backup/files/${filename}`, "/api/backup"].entries()) {
      const download = await request(route, { binary: true });
      assert.match(download.response.headers.get("content-type"), /application\/octet-stream/);
      assert.match(download.response.headers.get("content-disposition"), /attachment/);
      assert.match(download.response.headers.get("cache-control"), /no-store/);
      assert.equal(download.data.subarray(0, 16).toString(), "SQLite format 3\0");
      const downloadedPath = path.join(directory, `download-${index}.db`);
      await writeFile(downloadedPath, download.data);
      const backup = createClient({ url: pathToFileURL(downloadedPath).href });
      try {
        assert.equal((await backup.execute("PRAGMA integrity_check")).rows[0][0], "ok");
        const saved = await backup.execute({ sql: "SELECT title FROM WorkItem WHERE id = ?", args: [marker.id] });
        assert.equal(saved.rows[0]?.title, marker.title, `${route} omitted the latest committed WAL data`);
        assert.equal((await backup.execute("PRAGMA foreign_key_check")).rows.length, 0);
      } finally {
        backup.close();
      }
    }
    await error("/api/backup/files/not-a-backup.db", "GET", undefined, 400);
    await error("/api/backup/files/backup_1900-01-01.db", "GET", undefined, 404);
    await remove(`/api/work-items/${marker.id}`);
  });

  t.diagnostic(`${requestCount} HTTP checks completed against a disposable database.`);
});
