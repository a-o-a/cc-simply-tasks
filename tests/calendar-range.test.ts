import assert from "assert/strict";
import { eventDayKeys, kstDateStringToUtcMs, kstMonthGrid, utcMsToKstDateString } from "../lib/client/calendar";

type DayRange = { fromMs: number; toMs: number };
const DAY_MS = 86_400_000;

function range(from: string, to: string): DayRange {
  return { fromMs: kstDateStringToUtcMs(from), toMs: kstDateStringToUtcMs(to) };
}

export function runCalendarRangeTests() {
  const grid = kstMonthGrid(2026, 9);
  const longEvent = {
    startDateTime: "2006-01-01T00:00:00+09:00",
    endDateTime: "2046-01-01T00:00:00+09:00",
    allDay: true,
  };
  const keys = eventDayKeys(longEvent, { fromMs: grid[0], toMs: grid[41] + DAY_MS });
  assert.equal(keys.length, 42, "A long event must only index the 42 displayed month cells");
  assert.deepEqual(keys, grid.map(utcMsToKstDateString));

  const oneDay = {
    startDateTime: "2026-10-01T00:00:00+09:00",
    endDateTime: "2026-10-02T00:00:00+09:00",
    allDay: true,
  };
  assert.deepEqual(eventDayKeys(oneDay), ["2026-10-01"], "The original unbounded all-day API remains half-open");
  assert.deepEqual(eventDayKeys(oneDay, range("2026-10-02", "2026-10-04")), [], "All-day exclusive end must not leak into the next cell");
  assert.deepEqual(eventDayKeys({ ...oneDay, allDay: false }, range("2026-10-02", "2026-10-04")), ["2026-10-02"], "Timed events retain the existing inclusive end-day display");
  assert.deepEqual(eventDayKeys(longEvent, range("2026-10-01", "2026-10-02")), ["2026-10-01"], "The viewport end is exclusive");
  assert.deepEqual(eventDayKeys(longEvent, range("2026-10-02", "2026-10-02")), []);
  assert.deepEqual(eventDayKeys(longEvent, range("2026-10-03", "2026-10-02")), []);
  assert.deepEqual(eventDayKeys(longEvent, { fromMs: NaN, toMs: Infinity }), []);
  assert.deepEqual(eventDayKeys(oneDay, range("2026-09-01", "2026-09-30")), []);

  const midnightCrossing = {
    startDateTime: "2026-10-01T14:30:00Z",
    endDateTime: "2026-10-01T15:30:00Z",
    allDay: false,
  };
  assert.deepEqual(eventDayKeys(midnightCrossing, range("2026-10-01", "2026-10-03")), ["2026-10-01", "2026-10-02"], "Use KST dates on either side of midnight");
  assert.deepEqual(eventDayKeys(longEvent, range("2024-02-28", "2024-03-02")), ["2024-02-28", "2024-02-29", "2024-03-01"]);
  assert.deepEqual(eventDayKeys(longEvent, range("2026-12-31", "2027-01-02")), ["2026-12-31", "2027-01-01"]);
}
