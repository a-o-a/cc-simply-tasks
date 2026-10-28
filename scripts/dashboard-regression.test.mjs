import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client/node";
import { chromium, expect as playwrightExpect } from "@playwright/test";
import { startTestServer } from "./test-server.mjs";

const expect = playwrightExpect.configure({ timeout: 5_000 });

test("dashboard totals and failure recovery reflect the actual data", { timeout: 90_000 }, async (t) => {
  const { base, directory } = await startTestServer(t);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const timestamp = Date.parse(`${today}T09:00:00+09:00`);
  const sqlite = createClient({ url: pathToFileURL(path.join(directory, "smoke.db")).href });
  try {
    await sqlite.batch(Array.from({ length: 205 }, (_, index) => ({
      sql: 'INSERT INTO WorkItem(id,title,status,transferDate,createdAt,updatedAt) VALUES (?,?,?,?,?,?)',
      args: [`dashboard-${index}`, `경계 작업 ${String(index).padStart(3, "0")}`, "IN_PROGRESS", timestamp, timestamp + index, timestamp + index],
    })), "write");
  } finally { sqlite.close(); }
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const artifactDirectory = process.env.RELEASE_UI_ARTIFACT_DIR;
  async function screenshot(page, name) {
    if (!artifactDirectory) return;
    await mkdir(artifactDirectory, { recursive: true });
    await page.screenshot({ path: path.join(artifactDirectory, name) });
  }
  async function pageFor(t) {
    const context = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 1000 }, locale: "ko-KR", timezoneId: "Asia/Seoul" });
    t.after(() => context.close());
    await context.addInitScript(() => localStorage.setItem("cc-simply-tasks:actor-name", "대시보드 검수"));
    const page = await context.newPage();
    page.setDefaultTimeout(5_000);
    return page;
  }
  const section = (page, heading) => page.locator("main section").filter({ has: page.getByRole("heading", { name: heading, exact: true }) });
  const due = (page) => section(page, "이번주 이관 예정");
  const progress = (page) => section(page, "진행중인 작업");

  await t.test("both work summaries include the 205th result beyond the first API page", async (t) => {
    const page = await pageFor(t);
    await page.goto("/");
    await expect(due(page).getByText("205건", { exact: true })).toBeVisible();
    await expect(progress(page).getByText("205건", { exact: true })).toBeVisible();
    await expect(due(page).getByRole("button", { name: /경계 작업 000/ })).toBeVisible();
    await expect(progress(page).getByRole("button", { name: /경계 작업 000/ })).toBeVisible();
    await screenshot(page, "after-dashboard-205.png");
  });

  await t.test("a failed initial work load is not shown as zero or empty and can retry", async (t) => {
    const page = await pageFor(t);
    let fail = true;
    await page.route("**/api/work-items/count", (route) => fail
      ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "검수용 작업 조회 실패" } }) })
      : route.continue());
    await page.goto("/");
    const alert = page.locator("main").getByRole("alert");
    await expect(alert).toContainText("검수용 작업 조회 실패");
    await expect(page.getByText("건 전체", { exact: true }).locator("..")).toContainText("—");
    await expect(due(page).getByText("이번주 이관 예정인 작업이 없습니다.", { exact: true })).toBeHidden();
    await expect(progress(page).getByText("진행중인 작업이 없습니다.", { exact: true })).toBeHidden();
    await screenshot(page, "after-dashboard-work-error.png");
    fail = false;
    await alert.getByRole("button", { name: "다시 시도", exact: true }).click();
    await expect(due(page).getByText("205건", { exact: true })).toBeVisible();
    await expect(alert).toBeHidden();
  });

  await t.test("today's schedule and recent activity distinguish failure from an empty result", async (t) => {
    const page = await pageFor(t);
    await page.setViewportSize({ width: 390, height: 844 });
    let fail = true;
    for (const routePattern of ["**/api/calendar-events?**", "**/api/audit-logs?**"]) {
      await page.route(routePattern, (route) => fail
        ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "검수용 독립 조회 실패" } }) })
        : route.continue());
    }
    // Keep the tall work columns empty in this viewport check so the two
    // independently failing panels can be inspected without thousands of pixels.
    await page.route("**/api/work-items/count", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ total: 0, byStatus: {} }) }));
    await page.route("**/api/work-items?**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], nextCursor: null }) }));
    await page.goto("/");
    const calendar = section(page, "오늘 일정");
    const activity = section(page, "최근 활동");
    await expect(calendar.getByRole("alert")).toContainText("검수용 독립 조회 실패");
    await expect(activity.getByRole("alert")).toContainText("검수용 독립 조회 실패");
    await expect(calendar.getByText("오늘 일정이 없습니다.", { exact: true })).toBeHidden();
    await expect(activity.getByText("기록된 활동이 없습니다.", { exact: true })).toBeHidden();
    await activity.scrollIntoViewIfNeeded();
    assert.ok(await page.locator("main").evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
    await screenshot(page, "after-dashboard-mobile-errors.png");
    fail = false;
    await calendar.getByRole("button", { name: "다시 시도", exact: true }).click();
    await activity.getByRole("button", { name: "다시 시도", exact: true }).click();
    await expect(calendar.getByText("오늘 일정이 없습니다.", { exact: true })).toBeVisible();
    await expect(activity.getByText("기록된 활동이 없습니다.", { exact: true })).toBeVisible();
  });

  await t.test("late refreshes cannot replace newer results and failures preserve the last successful data", async (t) => {
    const page = await pageFor(t);
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto("/");
    await expect(progress(page).getByText("205건", { exact: true })).toBeVisible();
    let release, started, finished;
    const held = new Promise((resolve) => { release = resolve; });
    const requested = new Promise((resolve) => { started = resolve; });
    const delivered = new Promise((resolve) => { finished = resolve; });
    t.after(() => release());
    let mode = "hold";
    await page.route("**/api/work-items/count", async (route) => {
      if (mode === "hold") {
        mode = "normal";
        const response = await route.fetch();
        started();
        await held;
        await route.fulfill({ response });
        finished();
      } else if (mode === "fail") {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "검수용 새로고침 실패" } }) });
      } else await route.continue();
    });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await requested;
    const created = await fetch(`${base}/api/work-items`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "최신 새로고침 작업", status: "IN_PROGRESS", transferDate: `${today}T09:00:00+09:00` }),
    });
    assert.equal(created.status, 201);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(progress(page).getByText("206건", { exact: true })).toBeVisible();
    release();
    await delivered;
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(progress(page).getByText("206건", { exact: true })).toBeVisible();
    await expect(page.getByText("건 전체", { exact: true }).locator("..")).toContainText("206");
    mode = "fail";
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    const alert = page.locator("main").getByRole("alert");
    await expect(alert).toContainText("검수용 새로고침 실패");
    await expect(alert).toContainText("이전 조회 결과");
    await expect(progress(page).getByText("206건", { exact: true })).toBeVisible();
    mode = "normal";
    await alert.getByRole("button", { name: "다시 시도", exact: true }).click();
    await expect(alert).toBeHidden();
    assert.deepEqual(pageErrors, []);
  });
});
