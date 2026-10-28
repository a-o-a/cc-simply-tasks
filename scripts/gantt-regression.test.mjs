import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium, expect as playwrightExpect } from "@playwright/test";
import { startTestServer } from "./test-server.mjs";

const expect = playwrightExpect.configure({ timeout: 5_000 });
test("long Gantt timelines render a bounded viewport and preserve all dates", { timeout: 90_000 }, async (t) => {
  const { base } = await startTestServer(t);
  const response = await fetch(`${base}/api/work-items`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "10년 작업 기간", startDate: "2020-01-01T00:00:00+09:00", endDate: "2030-01-01T00:00:00+09:00" }),
  });
  assert.equal(response.status, 201);
  const holidays = [];
  for (const [title, start, end] of [
    ["첫 표시일 휴일", "2019-12-25", "2019-12-26"],
    ["마지막 표시일 휴일", "2030-01-08", "2030-01-09"],
    ["표시 범위 다음날 휴일", "2030-01-09", "2030-01-10"],
  ]) {
    const created = await fetch(`${base}/api/calendar-events`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, category: "HOLIDAY", allDay: true, startDateTime: `${start}T00:00:00+09:00`, endDateTime: `${end}T00:00:00+09:00` }),
    });
    assert.equal(created.status, 201);
    holidays.push(await created.json());
  }
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({ baseURL: base, viewport: { width: 1323, height: 972 }, locale: "ko-KR", timezoneId: "Asia/Seoul" });
  await context.addInitScript(() => localStorage.setItem("cc-simply-tasks:actor-name", "간트 검수"));
  const page = await context.newPage();
  await page.clock.setFixedTime("2026-10-28T12:00:00+09:00");
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/work-items");
  const holidayResponsePromise = page.waitForResponse((result) => new URL(result.url()).pathname === "/api/calendar-events");
  await page.getByRole("button", { name: "간트", exact: true }).click();
  const holidayResponse = await holidayResponsePromise;
  const chart = page.locator("main .overflow-x-auto.cursor-grab");
  await expect(chart.getByRole("button", { name: "10년 작업 기간", exact: true })).toBeVisible();
  const dayCount = () => chart.locator("div[title]").count();
  const width = await chart.evaluate((element) => element.scrollWidth);
  console.log(JSON.stringify({ name: "gantt-long-period", viewport: "1323x972", rendered_days: await dayCount(), chart_nodes: await chart.locator("*").count(), scroll_width_px: width }));
  assert.ok(width > 100_000, "The full ten-year timeline must remain scrollable");

  await t.test("the first displayed day uses KST holiday dates without shifting the UTC-based labels", async () => {
    const first = chart.locator('div[title="2019-12-25"]');
    await expect(first).toBeInViewport();
    await expect(first).toContainText("25");
    await expect(first).toHaveClass(/\btext-red-500\b/);
    // A one-day holiday ends at the next KST midnight, which is excluded.
    await expect(chart.locator('div[title="2019-12-26"]')).not.toHaveClass(/\btext-red-500\b/);
  });
  await t.test("holiday requests cover exactly the displayed KST dates and exclude next midnight", async () => {
    const query = new URL(holidayResponse.url()).searchParams;
    assert.equal(query.get("from"), "2019-12-24T15:00:00.000Z");
    assert.equal(query.get("to"), "2030-01-08T15:00:00.000Z");
    const result = await holidayResponse.json();
    assert.deepEqual(result.items.map((item) => item.id).sort(), holidays.slice(0, 2).map((item) => item.id).sort());
  });
  await t.test("desktop renders only visible date columns with overscan", async () => {
    await expect.poll(dayCount).toBeLessThanOrEqual(50);
  });
  await t.test("horizontal scrolling reaches the final date with the same track width", async () => {
    await chart.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
    await expect(chart.locator('div[title="2030-01-08"]')).toBeInViewport();
    await expect(chart.locator('div[title="2030-01-08"]')).toHaveClass(/\btext-red-500\b/);
    await expect.poll(dayCount).toBeLessThanOrEqual(50);
    assert.equal(await chart.evaluate((element) => element.scrollWidth), width);
  });
  await t.test("middle dates stay aligned with the original day grid", async () => {
    const column = (Date.parse("2025-01-01T00:00:00Z") - Date.parse("2019-12-25T00:00:00Z")) / 86_400_000;
    await chart.evaluate((element, left) => { element.scrollLeft = left; }, column * 32);
    const day = chart.locator('div[title="2025-01-01"]');
    await expect(day).toBeInViewport();
    const box = await day.boundingBox();
    const chartBox = await chart.boundingBox();
    assert.ok(Math.abs(box.x - chartBox.x - 161) <= 1, "The day begins immediately after the 160px sticky label and border");
  });
  await t.test("the work bar remains keyboard-accessible after scrolling", async () => {
    const bar = chart.getByRole("button", { name: "10년 작업 기간", exact: true });
    await bar.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog").getByRole("heading", { name: "10년 작업 기간", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(bar).toBeFocused();
  });
  await t.test("mobile resize recalculates columns and retains internal horizontal scrolling", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(dayCount).toBeLessThanOrEqual(20);
    await expect.poll(() => page.locator("main").evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    // At mobile width the filter form becomes taller and pushes the chart
    // below the fold. Scroll the main pane before testing horizontal visibility.
    await chart.scrollIntoViewIfNeeded();
    await chart.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
    await expect(chart.locator('div[title="2030-01-08"]')).toBeInViewport();
    assert.equal(await chart.evaluate((element) => element.scrollWidth), width);
  });
  assert.deepEqual(errors, []);
});
