import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Run on the documented Node 22.13 minimum without requiring native TS loading.
const source = await readFile(new URL("../lib/client/calendar.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { eventDayKeys, kstMonthGrid } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("long calendar events expand only into the visible month", () => {
  const grid = kstMonthGrid(2026, 9);
  const range = { fromMs: grid[0], toMs: grid[41] + 86_400_000 };
  const event = { startDateTime: "2020-01-01T00:00:00+09:00", endDateTime: "2030-01-01T00:00:00+09:00", allDay: true };
  const visible = eventDayKeys(event, range);
  assert.equal(visible.length, 42);
  assert.deepEqual(visible, eventDayKeys(event).filter((day) => day >= visible[0] && day <= visible.at(-1)));
  assert.deepEqual(eventDayKeys({ ...event, endDateTime: "2021-01-01T00:00:00+09:00" }, range), []);
});

test("range clipping preserves all-day exclusive endings and timed boundaries", () => {
  const event = { startDateTime: "2026-10-22T00:00:00+09:00", endDateTime: "2026-10-23T00:00:00+09:00", allDay: true };
  const range = { fromMs: Date.parse(event.startDateTime), toMs: Date.parse("2026-10-24T00:00:00+09:00") };
  assert.deepEqual(eventDayKeys(event, range), ["2026-10-22"]);
  assert.deepEqual(eventDayKeys({ ...event, allDay: false }, range), ["2026-10-22", "2026-10-23"]);
});
