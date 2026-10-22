import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client/node";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import ts from "typescript";

// node scripts/benchmark-pagination.mjs
// No server or user data is used. Both query variants run against the same
// in-memory SQLite fixture using the project's driver and committed migrations.
const root = fileURLToPath(new URL("../", import.meta.url));
const rows = 10_000;
const warmups = 3;
const measuredRuns = 15;

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    median_ms: Number(sorted[Math.floor(sorted.length / 2)].toFixed(3)),
    p95_ms: Number(sorted[Math.ceil(sorted.length * 0.95) - 1].toFixed(3)),
  };
}

async function compare(before, after) {
  const timings = { before: [], after: [] };
  for (let run = 0; run < warmups + measuredRuns; run += 1) {
    // Alternate order to avoid assigning all cache/thermal effects to one side.
    for (const name of run % 2 ? ["after", "before"] : ["before", "after"]) {
      const start = performance.now();
      await (name === "before" ? before : after)();
      if (run >= warmups) timings[name].push(performance.now() - start);
    }
  }
  return { before: stats(timings.before), after: stats(timings.after) };
}

const client = createClient({ url: ":memory:" });
try {
  await migrate(drizzle(client), { migrationsFolder: `${root}/drizzle` });
  const sequence = `WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM seq WHERE i < ${rows})`;
  await client.execute(`${sequence} INSERT INTO WorkItem(id,title,description,additionalNotes,requestContent,"order",status,createdAt,updatedAt) SELECT printf('work%020d',i), 'synthetic task '||i, printf('%02000d',i), printf('%01000d',i), printf('%01000d',i), i%7, 'WAITING', 1700000000000+CAST(i/5 AS INTEGER), 1700000000000+CAST(i/5 AS INTEGER) FROM seq`);
  await client.execute(`${sequence} INSERT INTO Todo(id,title,note,"order",createdAt,updatedAt) SELECT printf('todo%020d',i), 'synthetic todo '||i, printf('%04000d',i), i%7, 1700000000000+CAST(i/5 AS INTEGER), 1700000000000+CAST(i/5 AS INTEGER) FROM seq`);
  await client.execute(`${sequence} INSERT INTO AuditLog(id,entityType,entityId,action,beforeJson,afterJson,createdAt) SELECT printf('log%021d',i), 'WorkItem', 'fixture', 'UPDATE', json_object('description',printf('%02000d',i)), json_object('description',printf('%02000d',i)), 1700000000000+CAST(i/5 AS INTEGER) FROM seq`);

  for (const [name, sql] of [
    ["work-items", 'SELECT * FROM WorkItem WHERE deletedAt IS NULL AND status <> \'TRANSFERRED\' ORDER BY "order" ASC, createdAt DESC, id DESC'],
    ["todos", 'SELECT * FROM Todo WHERE deletedAt IS NULL ORDER BY "order" ASC, createdAt DESC, id DESC'],
    ["audit-logs", "SELECT * FROM AuditLog ORDER BY createdAt DESC, id DESC"],
  ]) {
    const before = await client.execute(sql);
    const after = await client.execute(`${sql} LIMIT 51`);
    assert.deepEqual(before.rows.slice(0, 51), after.rows);
    const timings = await compare(
      async () => (await client.execute(sql)).rows.slice(0, 51),
      async () => (await client.execute(`${sql} LIMIT 51`)).rows,
    );
    console.log(JSON.stringify({
      name, node: process.version, fixture_rows: rows, text_bytes_per_row: "approximately 4000", warmups, measuredRuns,
      ...timings, first_51_rows_identical: true,
      materialized_rows: { before: before.rows.length, after: after.rows.length },
      materialized_json_bytes: { before: Buffer.byteLength(JSON.stringify(before.rows)), after: Buffer.byteLength(JSON.stringify(after.rows)) },
      scope: "database driver query and materialization only; not HTTP transfer or browser rendering",
    }));
  }
} finally {
  client.close();
}

// Read the actual current pure helper. Transpiling this file in memory keeps
// the benchmark usable on Node 22 without building or touching the project.
const source = await readFile(new URL("../lib/client/calendar.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { eventDayKeys, kstMonthGrid } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const dayMs = 86_400_000;
const kstDate = (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
function kstStart(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) - 9 * 60 * 60 * 1000;
}
// Pre-fix algorithm, preserved here for repeatable before/after measurement.
function unboundedEventDayKeys(event) {
  const start = Date.parse(event.startDateTime);
  const end = Date.parse(event.endDateTime);
  const startDay = kstStart(kstDate(start));
  const endDay = kstStart(kstDate(event.allDay ? end - 1 : end));
  const keys = [];
  for (let ms = startDay; ms <= endDay; ms += dayMs) keys.push(kstDate(ms));
  return keys;
}
const event = { startDateTime: "2020-01-01T00:00:00+09:00", endDateTime: "2030-01-01T00:00:00+09:00", allDay: true };
const grid = kstMonthGrid(2026, 9);
const bounds = { fromMs: grid[0], toMs: grid[41] + dayMs };
const before = unboundedEventDayKeys(event);
const after = eventDayKeys(event, bounds);
assert.deepEqual(before.filter((day) => {
  const ms = Date.parse(`${day}T00:00:00+09:00`);
  return ms >= bounds.fromMs && ms < bounds.toMs;
}), after);
console.log(JSON.stringify({
  name: "calendar-visible-day-keys", node: process.version, fixture: "one valid 10-year all-day event, 42-day October 2026 grid", warmups, measuredRuns,
  ...await compare(() => unboundedEventDayKeys(event), () => eventDayKeys(event, bounds)),
  computed_dates: { before: before.length, after: after.length }, visible_keys_identical: true,
  scope: "actual pure calendar helper; not browser render timing",
}));
