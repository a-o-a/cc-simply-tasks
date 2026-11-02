import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client/node";
import { chromium, expect as playwrightExpect } from "@playwright/test";
import { startTestServer } from "./test-server.mjs";

// Run against the current production build. The server and every seeded row
// belong to a temporary database created by startTestServer, never the user DB.
const expect = playwrightExpect.configure({ timeout: 8_000 });

test("pagination and work-list regression checks", { timeout: 150_000 }, async (t) => {
  const { directory, base, serverLog } = await startTestServer(t);
  const sqlite = createClient({ url: pathToFileURL(path.join(directory, "smoke.db")).href });
  t.after(() => sqlite.close());
  const timestamp = Date.parse("2026-10-22T00:00:00+09:00");
  await sqlite.batch(Array.from({ length: 122 }, (_, index) => {
    const i = index + 1;
    return {
      sql: 'INSERT INTO WorkItem(id,title,category,status,"order",startDate,endDate,transferDate,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
      args: [
        `work-${i}`, i === 121 ? "먼저 검색 작업" : i === 122 ? "나중 검색 작업" : `페이지 작업 ${String(i).padStart(3, "0")}`,
        i % 2 ? "odd" : "even", i === 117 ? "HOLDING" : i % 5 ? "WAITING" : "TRANSFERRED", i % 3,
        timestamp, timestamp, timestamp + (i % 4) * 86_400_000,
        timestamp + Math.floor(i / 4), timestamp,
      ],
    };
  }), "write");
  await sqlite.batch(Array.from({ length: 122 }, (_, index) => ({
    sql: 'INSERT INTO Todo(id,title,status,"order",createdAt,updatedAt) VALUES (?,?,?,?,?,?)',
    args: [`todo-${index}`, `할 일 ${index}`, index % 3 ? "OPEN" : "DONE", index % 2, timestamp + Math.floor(index / 4), timestamp],
  })), "write");
  await sqlite.batch(Array.from({ length: 122 }, (_, index) => ({
    sql: "INSERT INTO AuditLog(id,entityType,entityId,action,actorName,createdAt) VALUES (?,?,?,?,?,?)",
    args: [`log-${index}`, "WorkItem", `work-${index}`, "UPDATE", index % 2 ? "odd" : "even", timestamp + Math.floor(index / 4)],
  })), "write");

  async function get(route, status = 200) {
    const response = await fetch(`${base}${route}`);
    const data = await response.json();
    assert.equal(response.status, status, `${route}: ${JSON.stringify(data).slice(0, 1000)}\n${serverLog()}`);
    return data;
  }

  await t.test("first page, tied sort keys, filters and subsequent pages match the full ordered result", async () => {
    for (const route of [
      "/api/work-items?scope=active", "/api/work-items?scope=transferred", "/api/work-items?scope=active&category=odd",
      "/api/todos?status=OPEN", "/api/audit-logs?actorName=odd",
    ]) {
      const complete = await get(`${route}&pageSize=200`);
      const seen = [];
      let cursor;
      do {
        const page = await get(`${route}&pageSize=17${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
        assert.ok(page.items.length <= 17);
        seen.push(...page.items.map((row) => row.id));
        cursor = page.nextCursor;
        assert.ok(seen.length <= complete.items.length, "Paging must make forward progress");
      } while (cursor);
      assert.deepEqual(seen, complete.items.map((row) => row.id), route);
      assert.equal(new Set(seen).size, seen.length, route);
    }
  });

  await t.test("a missing cursor gives an explicit recoverable error instead of repeating page one", async () => {
    for (const route of ["/api/work-items", "/api/todos", "/api/audit-logs"]) {
      const error = await get(`${route}?cursor=no-longer-in-list`, 400);
      assert.equal(error.error.code, "BAD_REQUEST");
      assert.ok((await get(route)).items.length > 0);
    }
    const first = await get("/api/work-items?scope=active&pageSize=17");
    const anchorId = first.items.at(-1).id;
    await sqlite.execute({ sql: "UPDATE WorkItem SET deletedAt=? WHERE id=?", args: [timestamp, anchorId] });
    try {
      const resumed = await get(`/api/work-items?scope=active&cursor=${encodeURIComponent(first.nextCursor)}&pageSize=17`);
      assert.equal(resumed.items.length, 17);
      assert.ok(resumed.items.every((item) => !first.items.some((seen) => seen.id === item.id)));
      assert.equal((await get(`/api/work-items?scope=active&cursor=${anchorId}`, 400)).error.code, "BAD_REQUEST");
    } finally {
      await sqlite.execute({ sql: "UPDATE WorkItem SET deletedAt=NULL WHERE id=?", args: [anchorId] });
    }
    const odd = await get("/api/work-items?scope=active&category=odd&pageSize=17");
    const oddAnchor = odd.items.at(-1).id;
    assert.equal((await get(`/api/work-items?scope=active&category=even&cursor=${oddAnchor}`, 400)).error.code, "BAD_REQUEST");
  });

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 1080 }, locale: "ko-KR", timezoneId: "Asia/Seoul" });
  t.after(() => context.close());
  await context.addInitScript(() => localStorage.setItem("cc-simply-tasks:actor-name", "페이지 검증"));
  const page = await context.newPage();
  page.setDefaultTimeout(8_000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await t.test("the 51st active item is reachable in table, kanban and gantt views", async () => {
    const all = await get("/api/work-items?scope=active&pageSize=200");
    const target = all.items[50];
    await page.goto("/work-items");
    const more = page.getByRole("button", { name: "다음", exact: true });
    await expect(more).toBeVisible();
    await expect(page.getByText(target.title, { exact: true })).toHaveCount(0);
    await more.click();
    await expect(page.getByText(target.title, { exact: true }).first()).toBeVisible();
    for (const view of ["칸반", "간트"]) {
      await page.getByRole("button", { name: view, exact: true }).click();
      const title = page.getByText(target.title, { exact: true }).first();
      await expect(title).toBeVisible();
      await title.click();
      await expect(page.getByRole("dialog").getByRole("heading", { name: target.title, exact: true })).toBeVisible();
      await page.getByRole("dialog").getByRole("button", { name: "닫기", exact: true }).click();
    }
  });

  await t.test("a deleted next-page anchor can resume at the next page", async () => {
    await page.reload();
    await page.getByRole("button", { name: "테이블", exact: true }).click();
    const first = await get("/api/work-items?scope=active&pageSize=50");
    const anchorId = first.items.at(-1).id;
    const rows = page.locator("main tbody tr");
    await expect(rows).toHaveCount(50);
    await sqlite.execute({ sql: "UPDATE WorkItem SET deletedAt=? WHERE id=?", args: [timestamp, anchorId] });
    try {
      await page.getByRole("button", { name: "다음", exact: true }).click();
      await expect(page.getByText("2 페이지", { exact: true })).toBeVisible();
      await expect(rows).toHaveCount(50);
      await expect(page.getByText(first.items[0].title, { exact: true })).toBeHidden();
      const expected = await get(`/api/work-items?scope=active&pageSize=50&cursor=${encodeURIComponent(first.nextCursor)}`);
      assert.deepEqual((await rows.locator("td:nth-child(3)").allTextContents()).map((value) => value.trim()), expected.items.map((item) => item.title));
    } finally {
      await sqlite.execute({ sql: "UPDATE WorkItem SET deletedAt=NULL WHERE id=?", args: [anchorId] });
    }
  });

  await t.test("debounced search ignores an older response and retries a failed load", async () => {
    await page.getByRole("button", { name: "테이블", exact: true }).click();
    const title = page.getByRole("textbox", { name: "작업 제목 검색", exact: true });
    const requests = [];
    let oldStarted;
    const oldRequestStarted = new Promise((resolve) => { oldStarted = resolve; });
    let releaseOld;
    const oldResponseReady = new Promise((resolve) => { releaseOld = resolve; });
    let oldCompleted;
    const oldResponseCompleted = new Promise((resolve) => { oldCompleted = resolve; });
    let fail = false;
    await page.route("**/api/work-items?**", async (route) => {
      const query = new URL(route.request().url()).searchParams.get("title");
      if (query) requests.push(query);
      if (query === "먼저") {
        const response = await route.fetch();
        oldStarted();
        await oldResponseReady;
        await route.fulfill({ response });
        oldCompleted();
      } else if (query === "실패" && fail) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "검증용 일시 오류" } }) });
      } else {
        await route.continue();
      }
    });
    await title.fill("먼저");
    await oldRequestStarted;
    await title.fill("나");
    await title.fill("나중");
    await expect(page.getByText("나중 검색 작업", { exact: true })).toBeVisible();
    releaseOld();
    await oldResponseCompleted;
    // Let the deliberately late response reach the browser before checking
    // state. An immediate assertion could miss a subsequent stale overwrite.
    await page.waitForTimeout(100);
    await expect(page.getByText("먼저 검색 작업", { exact: true })).toHaveCount(0);
    assert.ok(!requests.includes("나"), "A fast partial search must be debounced");

    fail = true;
    await title.fill("실패");
    await expect(page.locator("main").getByRole("alert")).toContainText("검증용 일시 오류");
    fail = false;
    await page.getByRole("button", { name: "다시 시도", exact: true }).click();
    await expect(page.getByText("조건에 맞는 작업이 없습니다", { exact: true })).toBeVisible();
    await page.unroute("**/api/work-items?**");
    await page.getByRole("button", { name: "초기화", exact: true }).click();
    await expect(page.getByRole("button", { name: "다음", exact: true })).toBeVisible();
  });

  await t.test("holding work stays accessible in the default kanban and status filter", async () => {
    const { items: holding } = await get("/api/work-items?scope=active&status=HOLDING");
    assert.equal(holding.length, 1);
    await page.getByRole("button", { name: "테이블", exact: true }).click();
    await expect(page.getByText(holding[0].title, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "칸반", exact: true }).click();
    const card = page.getByText(holding[0].title, { exact: true });
    await expect(card).toBeVisible();
    await card.click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: holding[0].title, exact: true })).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "닫기", exact: true }).click();
    const statusFilter = page.getByRole("button", { name: "홀딩", exact: true });
    const filteredResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/work-items" && url.searchParams.get("status") === "HOLDING";
    });
    await statusFilter.click();
    assert.equal((await filteredResponse).status(), 200);
    await expect(statusFilter).toHaveAttribute("aria-pressed", "true");
    await expect(card).toBeVisible();
    await expect(page.getByText("조건에 맞는 전체 작업 1건", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "초기화", exact: true }).click();
    await expect(statusFilter).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: "테이블", exact: true }).click();
    await expect(page.getByRole("button", { name: "다음", exact: true })).toBeEnabled();
  });

  await t.test("mobile filter labels and controls remain within the viewport", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const locator of [
      page.getByRole("button", { name: "작업 추가", exact: true }),
      page.getByRole("button", { name: "진행 작업", exact: true }),
      page.getByRole("textbox", { name: "작업 제목 검색", exact: true }),
      page.getByRole("textbox", { name: "요청번호 검색", exact: true }),
    ]) {
      await expect(locator).toBeVisible();
      const box = await locator.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= 391, "Controls must fit a 390px viewport");
    }
  });
  assert.deepEqual(pageErrors, []);
});
