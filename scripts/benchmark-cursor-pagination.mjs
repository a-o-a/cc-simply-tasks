import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import { and, asc, desc, eq, getTableColumns, isNull, ne } from "drizzle-orm";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client/node";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

// Isolated, repeatable comparison of the old full-materialization cursor path
// and the bounded cursor query. No server, user DB or schema changes are used.
const root = fileURLToPath(new URL("../", import.meta.url));
const fixtureRows = 10_000;
const pageSize = 50;
const warmups = 3;
const measuredRuns = 15;
const client = createClient({ url: ":memory:" });
const db = drizzle(client);

// Load the actual current schema and cursor helper without a server/build.
// Explicit import URLs let these transpiled data modules resolve dependencies.
async function moduleUrl(relativePath, replacements = {}) {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  let compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  for (const [specifier, resolved] of Object.entries(replacements)) compiled = compiled.replaceAll(JSON.stringify(specifier), JSON.stringify(resolved));
  return `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
}
const httpUrl = await moduleUrl("../lib/http.ts", { "next/server": import.meta.resolve("next/server.js"), zod: import.meta.resolve("zod") });
const { inclusiveCursorCondition, slicePageAfterCursor } = await import(await moduleUrl("../lib/pagination.ts", {
  "@/lib/http": httpUrl, zod: import.meta.resolve("zod"), "drizzle-orm": import.meta.resolve("drizzle-orm"),
}));
const { workItems, todos, auditLogs } = await import(await moduleUrl("../lib/db/schema.ts", {
  "drizzle-orm": import.meta.resolve("drizzle-orm"), "drizzle-orm/sqlite-core": import.meta.resolve("drizzle-orm/sqlite-core"),
}));

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    median_ms: Number(sorted[Math.floor(sorted.length / 2)].toFixed(3)),
    p95_ms: Number(sorted[Math.ceil(sorted.length * 0.95) - 1].toFixed(3)),
  };
}
async function compare(before, after) {
  const values = { before: [], after: [] };
  for (let run = 0; run < warmups + measuredRuns; run++) {
    for (const name of run % 2 ? ["after", "before"] : ["before", "after"]) {
      const start = performance.now();
      await (name === "before" ? before : after)();
      if (run >= warmups) values[name].push(performance.now() - start);
    }
  }
  return { before: stats(values.before), after: stats(values.after) };
}

try {
  await migrate(drizzle(client), { migrationsFolder: `${root}/drizzle` });
  const sequence = `WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM seq WHERE i < ${fixtureRows})`;
  await client.execute(`${sequence} INSERT INTO WorkItem(id,title,description,additionalNotes,requestContent,"order",status,transferDate,createdAt,updatedAt) SELECT printf('work%020d',i), 'task '||i, printf('%02000d',i), printf('%01000d',i), printf('%01000d',i), i%7, 'WAITING', CASE WHEN i%5=0 THEN NULL ELSE 1700000000000+(i%17) END, 1700000000000+CAST(i/5 AS INTEGER), 1700000000000 FROM seq`);
  await client.execute(`${sequence} INSERT INTO Todo(id,title,note,"order",createdAt,updatedAt) SELECT printf('todo%020d',i), 'todo '||i, printf('%04000d',i), i%7, 1700000000000+CAST(i/5 AS INTEGER), 1700000000000 FROM seq`);
  await client.execute(`${sequence} INSERT INTO AuditLog(id,entityType,entityId,action,beforeJson,afterJson,createdAt) SELECT printf('log%021d',i), 'WorkItem', 'fixture', 'UPDATE', json_object('description',printf('%02000d',i)), json_object('description',printf('%02000d',i)), 1700000000000+CAST(i/5 AS INTEGER) FROM seq`);
  for (const [name, table, filter, keys] of [
    ["work-items-active-cursor", workItems, and(isNull(workItems.deletedAt), ne(workItems.status, "TRANSFERRED")), [["order", "asc"], ["createdAt", "desc"], ["id", "desc"]]],
    ["work-items-transfer-order-cursor", workItems, isNull(workItems.deletedAt), [["transferDate", "desc", true], ["createdAt", "desc"], ["id", "desc"]]],
    ["todos-cursor", todos, isNull(todos.deletedAt), [["order", "asc"], ["createdAt", "desc"], ["id", "desc"]]],
    ["audit-logs-cursor", auditLogs, undefined, [["createdAt", "desc"], ["id", "desc"]]],
  ]) {
    const order = keys.map(([column, direction]) => direction === "asc" ? asc(table[column]) : desc(table[column]));
    const beforeQuery = db.select().from(table).where(filter).orderBy(...order);
    const complete = await beforeQuery;
    for (const cursorIndex of [49, 4999, 9499]) {
      const cursor = complete[cursorIndex].id;
      const anchor = db.$with("page_cursor").as(db.select(Object.fromEntries(keys.map(([column]) => [column, table[column]])))
        .from(table).where(and(filter, eq(table.id, cursor))).limit(1));
      const boundary = inclusiveCursorCondition(keys.map(([column, direction, nullable]) => ({ column: table[column], anchor: anchor[column], direction, nullable })));
      const afterQuery = db.with(anchor).select(getTableColumns(table)).from(table).innerJoin(anchor, boundary)
        .where(filter).orderBy(...order).limit(pageSize + 2);
      const bounded = await afterQuery;
      assert.deepEqual(bounded, complete.slice(cursorIndex, cursorIndex + pageSize + 2));
      assert.deepEqual(slicePageAfterCursor(bounded, cursor, pageSize), slicePageAfterCursor(complete, cursor, pageSize));
      const timing = await compare(
        async () => slicePageAfterCursor(await beforeQuery, cursor, pageSize),
        async () => slicePageAfterCursor(await afterQuery, cursor, pageSize),
      );
      console.log(JSON.stringify({
        name, node: process.version, fixture_rows: fixtureRows, pageSize, cursor_index: cursorIndex,
        warmups, measuredRuns, ...timing, rows_identical: true,
        materialized_rows: { before: complete.length, after: bounded.length },
        materialized_json_bytes: { before: Buffer.byteLength(JSON.stringify(complete)), after: Buffer.byteLength(JSON.stringify(bounded)) },
        scope: "database driver query and materialization; excludes HTTP, hydration and browser rendering",
      }));
    }
  }
} finally {
  client.close();
}
