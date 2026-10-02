import assert from "assert";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import { workItems, type WorkItemRow } from "../lib/db/schema";
import { createCursorPagination, cursorCondition, decodeCursor, encodeCursor, parsePagination, type CursorKey } from "../lib/pagination";
import { assertDateOrder, kstDateStringSchema } from "../lib/validation/common";
import { todoCreateSchema, todoUpdateSchema, todoChecklistReorderSchema, todoListQuerySchema } from "../lib/validation/todo";
import { calendarEventUpdateSchema } from "../lib/validation/calendarEvent";
import { workItemListQuerySchema } from "../lib/validation/workItem";
import { computeDiff } from "../lib/diff";
import { newId, ticketSummaries } from "../lib/db/helpers";
import { getActorContext } from "../lib/actor";

export async function runBackendTests() {
  const start = new Date("2026-10-02T10:00:00Z");
  const end = new Date("2026-10-02T11:00:00Z");
  assert.doesNotThrow(() => assertDateOrder(start, end, "endDateTime"));
  assert.throws(() => assertDateOrder(end, start, "endDateTime"), z.ZodError);
  assert.throws(() => assertDateOrder(start, start, "endDateTime"), z.ZodError);
  assert.doesNotThrow(() => assertDateOrder(start, start, "endDate", true));
  assert.doesNotThrow(() => assertDateOrder(null, start, "endDate", true));
  assert.equal(kstDateStringSchema.safeParse("2026-02-29").success, false);
  assert.equal(kstDateStringSchema.safeParse("2024-02-29").success, true);
  const generatedIds = Array.from({ length: 100 }, () => newId());
  assert.equal(new Set(generatedIds).size, generatedIds.length, "Upgraded CUID generation remains usable by the backend and test runtime");
  assert.ok(generatedIds.every((id) => /^[a-z][a-z0-9]{23}$/.test(id)), "New IDs retain the existing CUID2 format");
  const actorRequest = (headers: Record<string, string>) => ({ headers: { get: (name: string) => headers[name] ?? null } as Headers });
  assert.equal(getActorContext(actorRequest({ "x-forwarded-for": "192.0.2.1, 192.0.2.2", "x-real-ip": "192.0.2.3" })).actorIp, "192.0.2.1");
  assert.equal(getActorContext(actorRequest({ "x-real-ip": "192.0.2.3" })).actorIp, "192.0.2.3");
  assert.equal(getActorContext(actorRequest({})).actorIp, null, "NextRequest.ip is no longer available in current Next.js");
  assert.deepEqual(todoUpdateSchema.parse({}), {}, "Partial updates must not receive create defaults");
  assert.deepEqual(calendarEventUpdateSchema.parse({}), {}, "An omitted member list must not clear calendar relationships");

  const todo = todoUpdateSchema.parse({ title: "할 일", checklist: [
    { id: "existing", content: "기존", done: true, assigneeId: null },
    { content: "신규" },
  ] });
  assert.equal(todo.checklist?.[0].id, "existing");
  assert.equal(todo.checklist?.[1].id, undefined);
  assert.equal(todo.checklist?.[1].order, undefined, "New checklist rows should receive their array position in the API");
  assert.deepEqual(todoUpdateSchema.parse({ checklist: [] }).checklist, [], "Empty checklist means delete all active children");
  assert.equal(todoUpdateSchema.parse({ title: "본문만" }).checklist, undefined, "Omitting checklist keeps existing children");
  assert.equal(todoUpdateSchema.safeParse({ checklist: [{ id: "same", content: "a" }, { id: "same", content: "b" }] }).success, false);
  assert.equal(todoCreateSchema.safeParse({ title: "many", checklist: Array.from({ length: 1001 }, () => ({ content: "child" })) }).success, false);
  assert.equal(todoCreateSchema.safeParse({ title: "   " }).success, false);
  assert.equal(todoChecklistReorderSchema.safeParse({ ids: ["same", "same"] }).success, false);
  assert.equal(calendarEventUpdateSchema.safeParse({ memberIds: ["same", "same"] }).success, false);
  assert.equal(workItemListQuerySchema.safeParse({ status: "TYPO" }).success, false, "Invalid filters must not silently broaden a query");
  assert.equal(workItemListQuerySchema.safeParse({ hasTransferDate: "TYPO" }).success, false);
  assert.equal(workItemListQuerySchema.parse({}).hasTransferDate, false, "Omitted transfer filters retain their existing default");
  assert.equal(workItemListQuerySchema.parse({ hasTransferDate: "true" }).hasTransferDate, true);
  assert.equal(workItemListQuerySchema.parse({ hasTransferDate: "false" }).hasTransferDate, false);
  assert.deepEqual(todoListQuerySchema.parse({}).include, [], "Omitted include keeps the existing query contract");
  assert.deepEqual(todoListQuerySchema.parse({ include: "checklist" }).include, ["checklist"]);
  assert.equal(todoListQuerySchema.safeParse({ include: "unknown" }).success, false);
  assert.equal(workItemListQuerySchema.safeParse({ transferDate: "2026-10-03", transferDateTo: "2026-10-02" }).success, false);

  assert.deepEqual(computeDiff({ title: "same", updatedAt: start }, { title: "same", updatedAt: end }), { before: {}, after: {} });
  const beforeTickets = [{ systemName: "B", ticketNumber: "2" }, { systemName: "A", ticketNumber: "1" }];
  assert.deepEqual(ticketSummaries(beforeTickets), ticketSummaries([...beforeTickets].reverse()));
  const changed = computeDiff({ tickets: ticketSummaries(beforeTickets) }, { tickets: ticketSummaries([{ systemName: "A", ticketNumber: "changed" }]) });
  assert.ok(changed.before.tickets && changed.after.tickets, "Ticket edits must remain visible in the parent audit diff");

  assert.deepEqual(parsePagination(new URLSearchParams()), { take: 50, cursor: undefined });
  assert.throws(() => parsePagination(new URLSearchParams("pageSize=201")), z.ZodError);
  const keys: CursorKey<WorkItemRow>[] = [
    { column: workItems.transferDate, value: (row) => row.transferDate, direction: "desc" },
    { column: workItems.createdAt, value: (row) => row.createdAt, direction: "desc" },
    { column: workItems.id, value: (row) => row.id, direction: "desc" },
  ];
  const token = encodeCursor("transferred", [null, start, "id"]);
  assert.deepEqual(decodeCursor(token, "transferred"), [null, start.getTime(), "id"]);
  assert.throws(() => decodeCursor(token, "other-scope"), z.ZodError);
  assert.throws(() => decodeCursor("page:garbage", "transferred"), z.ZodError);
  assert.throws(() => cursorCondition(keys, [null, "not-a-date", "id"]), z.ZodError);
  assert.throws(() => cursorCondition(keys, [null, 1e300, "id"]), z.ZodError);
  assert.throws(() => cursorCondition(keys, [null, start.getTime(), null]), z.ZodError);

  const dialect = new SQLiteSyncDialect();
  const nullCursorSql = dialect.sqlToQuery(cursorCondition(keys, [null, start.getTime(), "id"]));
  assert.ok(nullCursorSql.sql.includes('"transferDate" is null'), "A NULL transfer date must continue within the NULL group");
  assert.ok(nullCursorSql.params.includes(start.getTime()));
  const dateCursorSql = dialect.sqlToQuery(cursorCondition(keys, [end.getTime(), start.getTime(), "id' OR 1=1 --"]));
  assert.ok(dateCursorSql.sql.includes('"transferDate" is null'), "After a descending date the page must also reach NULL dates");
  assert.ok(!dateCursorSql.sql.includes("OR 1=1"), "Cursor values must remain bound parameters");
  assert.ok(dateCursorSql.params.includes("id' OR 1=1 --"));

  const pagination = createCursorPagination("transferred", keys);
  const firstRow = { id: "first", transferDate: end, createdAt: start } as WorkItemRow;
  const nextRow = { id: "second", transferDate: null, createdAt: start } as WorkItemRow;
  const firstPage = pagination.page([firstRow, nextRow], 1);
  assert.equal(firstPage.items.length, 1);
  assert.ok(firstPage.nextCursor);
  let lookupCount = 0;
  await pagination.condition(firstPage.nextCursor!, async () => { lookupCount += 1; return undefined; });
  assert.equal(lookupCount, 0, "Opaque cursors should survive deletion of their anchor row without a lookup");
  await pagination.condition("first", async (id) => { lookupCount += 1; assert.equal(id, "first"); return firstRow; });
  assert.equal(lookupCount, 1, "Legacy ID cursors remain supported");
  await assert.rejects(() => pagination.condition("missing", async () => undefined), z.ZodError);
  assert.equal(pagination.page([nextRow], 1).nextCursor, null);
  return "backend validation, audit diff, cursor compatibility and SQL parameter checks passed";
}
