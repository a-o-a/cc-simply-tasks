import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client/node";
import { startTestServer } from "./test-server.mjs";

// Run after npm run build. Every write is confined to the helper's temporary DB.
test("TODO edits commit the parent, checklist and audit records atomically", { timeout: 60_000 }, async (t) => {
  const { base, directory, serverLog } = await startTestServer(t);
  const sqlite = createClient({ url: pathToFileURL(path.join(directory, "smoke.db")).href });
  t.after(() => sqlite.close());

  async function request(route, method = "GET", body, status = 200) {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: { "Content-Type": "application/json", "x-actor-name": "todo-regression" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    assert.equal(response.status, status, `${method} ${route}: ${text}\n${serverLog()}`);
    return text ? JSON.parse(text) : null;
  }
  const create = (body) => request("/api/todos", "POST", body, 201);
  const get = (id) => request(`/api/todos/${id}`);
  const auditCount = async () => Number((await sqlite.execute('SELECT count(*) AS count FROM "AuditLog"')).rows[0].count);

  await t.test("one PATCH preserves existing IDs, creates/deletes children and returns the saved draft", async () => {
    const todo = await create({ title: "before", checklist: [{ content: "keep" }, { content: "remove", order: 1 }] });
    const [keep, remove] = todo.checklist;
    const saved = await request(`/api/todos/${todo.id}`, "PATCH", {
      title: "after",
      checklist: [
        { id: keep.id, content: "kept and completed", done: true },
        { content: "new item", done: false },
      ],
    });
    assert.equal(saved.title, "after");
    assert.ok(Array.isArray(saved.checklist), "PATCH must return the saved checklist without another GET");
    assert.deepEqual(saved.checklist.map(({ content, order }) => [content, order]), [["kept and completed", 0], ["new item", 1]]);
    assert.equal(saved.checklist[0].id, keep.id);
    assert.equal(saved.checklist[0].done, true);
    assert.deepEqual((await get(todo.id)).checklist, saved.checklist);
    const deleted = await sqlite.execute({ sql: 'SELECT "deletedAt" FROM "TodoChecklist" WHERE id = ?', args: [remove.id] });
    assert.ok(deleted.rows[0].deletedAt, "Removed checklist rows must be soft deleted");
    for (const [id, action] of [[keep.id, "UPDATE"], [remove.id, "DELETE"], [saved.checklist[1].id, "CREATE"]]) {
      const logs = await request(`/api/audit-logs?entityType=TodoChecklist&entityId=${id}`);
      assert.ok(logs.items.some((log) => log.action === action && log.actorName === "todo-regression"));
    }
    // Repeating a saved draft must keep IDs stable and must not duplicate children.
    const repeated = await request(`/api/todos/${todo.id}`, "PATCH", {
      title: saved.title,
      checklist: saved.checklist.map(({ id, content, done, assigneeId }) => ({ id, content, done, assigneeId })),
    });
    assert.deepEqual(repeated.checklist.map((item) => item.id), saved.checklist.map((item) => item.id));
  });

  await t.test("foreign and duplicate checklist IDs are rejected before any draft is committed", async () => {
    const todo = await create({ title: "owner", checklist: [{ content: "owned" }] });
    const other = await create({ title: "other", checklist: [{ content: "foreign" }] });
    const before = await get(todo.id);
    const count = await auditCount();
    await request(`/api/todos/${todo.id}`, "PATCH", {
      title: "must not persist",
      checklist: [{ id: other.checklist[0].id, content: "foreign overwrite" }],
    }, 400);
    assert.deepEqual(await get(todo.id), before);
    assert.equal((await get(other.id)).checklist[0].content, "foreign");
    assert.equal(await auditCount(), count);
    const child = { id: todo.checklist[0].id, content: "same ID" };
    await request(`/api/todos/${todo.id}`, "PATCH", { title: "duplicate", checklist: [child, child] }, 400);
    assert.deepEqual(await get(todo.id), before);
  });

  await t.test("a checklist write failure rolls back parent, removals and audits, then a retry succeeds once", async () => {
    const todo = await create({ title: "rollback original", checklist: [{ content: "keep original" }, { content: "remove original", order: 1 }] });
    const before = await get(todo.id);
    const count = await auditCount();
    const draft = {
      title: "retried draft",
      checklist: [{ id: todo.checklist[0].id, content: "kept edit", done: true }, { content: "reject-once" }],
    };
    await sqlite.execute('CREATE TRIGGER "todo_regression_failure" BEFORE INSERT ON "TodoChecklist" WHEN NEW.content = \'reject-once\' BEGIN SELECT RAISE(ABORT, \'injected checklist failure\'); END');
    try {
      await request(`/api/todos/${todo.id}`, "PATCH", draft, 500);
      assert.deepEqual(await get(todo.id), before, "Every field must roll back when a child write fails");
      assert.equal(await auditCount(), count, "Failed writes must not leave audit rows");
    } finally {
      await sqlite.execute('DROP TRIGGER "todo_regression_failure"');
    }
    await request(`/api/todos/${todo.id}`, "PATCH", draft);
    const saved = await get(todo.id);
    assert.equal(saved.title, "retried draft");
    assert.equal(saved.checklist[0].id, todo.checklist[0].id);
    assert.deepEqual(saved.checklist.map((item) => item.content), ["kept edit", "reject-once"]);
    // If the successful response was lost, retrying the original draft still
    // replaces the checklist rather than appending the new row a second time.
    await request(`/api/todos/${todo.id}`, "PATCH", draft);
    assert.deepEqual((await get(todo.id)).checklist.map((item) => item.content), ["kept edit", "reject-once"]);
  });

  await t.test("omitting checklist preserves children and individual checklist APIs keep working", async () => {
    const todo = await create({ title: "individual APIs", checklist: [{ content: "preserved" }] });
    await request(`/api/todos/${todo.id}`, "PATCH", { note: "parent only" });
    assert.deepEqual((await get(todo.id)).checklist, todo.checklist);
    const added = await request(`/api/todos/${todo.id}/checklist`, "POST", { content: "individual create" }, 201);
    await request(`/api/todos/${todo.id}/checklist/${added.id}`, "PATCH", { done: true });
    assert.equal((await get(todo.id)).checklist.find((item) => item.id === added.id).done, true);
    await request(`/api/todos/${todo.id}/checklist/${added.id}`, "DELETE", undefined, 204);
    assert.equal((await get(todo.id)).checklist.length, 1);
    await request(`/api/todos/${todo.id}`, "PATCH", { checklist: [] });
    assert.deepEqual((await get(todo.id)).checklist, []);
  });

  for (const change of ["add", "complete"]) {
    await t.test(`a stale drawer cannot overwrite another client's checklist ${change}`, async () => {
      const todo = await create({ title: "shared TODO", checklist: [{ content: "shared item" }] });
      if (change === "add") {
        await request(`/api/todos/${todo.id}/checklist`, "POST", { content: "another client's item", order: 1 }, 201);
      } else {
        await request(`/api/todos/${todo.id}/checklist/${todo.checklist[0].id}`, "PATCH", { done: true });
      }
      const before = await get(todo.id);
      const count = await auditCount();
      const error = await request(`/api/todos/${todo.id}`, "PATCH", {
        title: "stale draft title",
        expectedUpdatedAt: todo.updatedAt,
        checklist: todo.checklist.map(({ id, content, done, assigneeId }) => ({ id, content, done, assigneeId })),
      }, 409);
      assert.equal(error.error.code, "CONFLICT");
      assert.deepEqual(await get(todo.id), before, "The newer checklist and parent must remain unchanged");
      assert.equal(await auditCount(), count, "Rejected stale edits must not produce audit records");
      const refreshed = await request(`/api/todos/${todo.id}`, "PATCH", {
        title: "reviewed draft title",
        expectedUpdatedAt: before.updatedAt,
        checklist: before.checklist.map(({ id, content, done, assigneeId }) => ({ id, content, done, assigneeId })),
      });
      assert.equal(refreshed.title, "reviewed draft title");
      assert.deepEqual(refreshed.checklist, before.checklist);
    });
  }

  await t.test("every parent/checklist write advances the parent version even when the clock has not advanced", async () => {
    const todo = await create({ title: "monotonic version", checklist: [{ content: "first" }, { content: "second", order: 1 }] });
    const futureVersion = Date.now() + 60_000;
    await sqlite.execute({ sql: 'UPDATE "Todo" SET "updatedAt" = ? WHERE id = ?', args: [futureVersion, todo.id] });
    let previousVersion = futureVersion;
    async function assertAdvanced() {
      const current = await get(todo.id);
      const version = new Date(current.updatedAt).getTime();
      assert.ok(version > previousVersion, `${version} must be greater than ${previousVersion}`);
      previousVersion = version;
      return current;
    }
    await request(`/api/todos/${todo.id}`, "PATCH", { note: "parent write", expectedUpdatedAt: new Date(futureVersion).toISOString() });
    await assertAdvanced();
    const added = await request(`/api/todos/${todo.id}/checklist`, "POST", { content: "third", order: 2 }, 201);
    await assertAdvanced();
    await request(`/api/todos/${todo.id}/checklist/${added.id}`, "PATCH", { done: true });
    await assertAdvanced();
    await request(`/api/todos/${todo.id}/checklist`, "PATCH", { ids: [added.id, ...todo.checklist.map((item) => item.id)] }, 204);
    await assertAdvanced();
    await request(`/api/todos/${todo.id}/checklist/${added.id}`, "DELETE", undefined, 204);
    await assertAdvanced();
  });
});
