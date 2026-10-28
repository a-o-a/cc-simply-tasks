import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client/node";
import { startTestServer } from "./test-server.mjs";

test("relationship changes are present in their parent's audit trail", { timeout: 60_000 }, async (t) => {
  const { base, directory } = await startTestServer(t);
  async function request(path, method = "GET", body) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", "x-actor-name": encodeURIComponent("관계 감사 검수") },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const json = await response.json();
    assert.equal(response.status, method === "POST" ? 201 : 200, JSON.stringify(json));
    return json;
  }
  async function audits(entityType, entityId) {
    const result = await request(`/api/audit-logs?entityType=${entityType}&entityId=${entityId}`);
    return result.items;
  }
  const originalTickets = [{ systemName: "ERP", ticketNumber: "ERP-100" }];
  const updatedTickets = [{ systemName: "CRM", ticketNumber: "CRM-200" }];

  await t.test("work creation records the initial tickets", async () => {
    const work = await request("/api/work-items", "POST", { title: "생성 티켓 감사", tickets: originalTickets });
    const logs = await audits("WorkItem", work.id);
    assert.equal(logs.length, 1);
    assert.deepEqual(JSON.parse(logs[0].afterJson).tickets, originalTickets);
  });

  await t.test("ticket-only changes retain before and after values", async () => {
    const work = await request("/api/work-items", "POST", { title: "티켓 변경 감사", tickets: originalTickets });
    await request(`/api/work-items/${work.id}`, "PATCH", { tickets: updatedTickets });
    const logs = await audits("WorkItem", work.id);
    const log = logs.find((item) => item.action === "UPDATE");
    assert.ok(log, "ticket-only updates must create an audit event");
    assert.deepEqual(JSON.parse(log.beforeJson).tickets, originalTickets);
    assert.deepEqual(JSON.parse(log.afterJson).tickets, updatedTickets);
  });

  await t.test("removing all tickets records the prior values and empty result", async () => {
    const work = await request("/api/work-items", "POST", { title: "티켓 제거 감사", tickets: originalTickets });
    await request(`/api/work-items/${work.id}`, "PATCH", { tickets: [] });
    const logs = await audits("WorkItem", work.id);
    const log = logs.find((item) => item.action === "UPDATE");
    assert.ok(log);
    assert.deepEqual(JSON.parse(log.beforeJson).tickets, originalTickets);
    assert.deepEqual(JSON.parse(log.afterJson).tickets, []);
    assert.equal((await request(`/api/work-items/${work.id}`)).tickets.length, 0);
  });

  await t.test("calendar member replacements retain the previous membership", async () => {
    const first = await request("/api/team-members", "POST", { name: "기존 담당자", role: "WEB_DEV" });
    const second = await request("/api/team-members", "POST", { name: "새 담당자", role: "WEB_DEV" });
    const event = await request("/api/calendar-events", "POST", {
      title: "일정 담당자 감사",
      startDateTime: "2026-10-28T09:00:00+09:00",
      endDateTime: "2026-10-28T10:00:00+09:00",
      memberIds: [first.id],
    });
    await request(`/api/calendar-events/${event.id}`, "PATCH", { memberIds: [second.id] });
    const logs = await audits("CalendarEvent", event.id);
    const log = logs.find((item) => item.action === "UPDATE");
    assert.ok(log);
    assert.deepEqual(JSON.parse(log.beforeJson).memberIds, [first.id]);
    assert.deepEqual(JSON.parse(log.afterJson).memberIds, [second.id]);
  });

  await t.test("unchanged memberships do not appear as relation changes", async () => {
    const first = await request("/api/team-members", "POST", { name: "담당자 1", role: "WEB_DEV" });
    const second = await request("/api/team-members", "POST", { name: "담당자 2", role: "WEB_DEV" });
    const event = await request("/api/calendar-events", "POST", {
      title: "담당자 유지",
      startDateTime: "2026-10-28T09:00:00+09:00",
      endDateTime: "2026-10-28T10:00:00+09:00",
      memberIds: [first.id, second.id],
    });
    await request(`/api/calendar-events/${event.id}`, "PATCH", { title: "제목만 변경", memberIds: [second.id, first.id] });
    const log = (await audits("CalendarEvent", event.id)).find((item) => item.action === "UPDATE");
    assert.equal(JSON.parse(log.beforeJson).memberIds, undefined);
    assert.equal(JSON.parse(log.afterJson).memberIds, undefined);
    assert.equal(JSON.parse(log.afterJson).title, "제목만 변경");
  });

  await t.test("an audit write failure rolls back the parent and ticket replacement", async () => {
    const work = await request("/api/work-items", "POST", { title: "감사 실패 롤백", tickets: originalTickets });
    const before = await request(`/api/work-items/${work.id}`);
    const beforeLogs = await audits("WorkItem", work.id);
    const sqlite = createClient({ url: pathToFileURL(path.join(directory, "smoke.db")).href });
    try {
      await sqlite.execute("CREATE TRIGGER reject_relation_audit BEFORE INSERT ON AuditLog WHEN NEW.action = 'UPDATE' BEGIN SELECT RAISE(FAIL, 'test audit rejection'); END");
      const response = await fetch(`${base}/api/work-items/${work.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "저장되면 안 되는 제목", tickets: updatedTickets }),
      });
      assert.equal(response.status, 500);
      const after = await request(`/api/work-items/${work.id}`);
      assert.deepEqual(after, before);
      assert.deepEqual(await audits("WorkItem", work.id), beforeLogs);
    } finally {
      await sqlite.execute("DROP TRIGGER IF EXISTS reject_relation_audit");
      sqlite.close();
    }
    await request(`/api/work-items/${work.id}`, "PATCH", { tickets: updatedTickets });
    assert.deepEqual((await request(`/api/work-items/${work.id}`)).tickets.map(({ systemName, ticketNumber }) => ({ systemName, ticketNumber })), updatedTickets);
  });
});
