import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium, expect as playwrightExpect } from "@playwright/test";
import { startTestServer } from "./test-server.mjs";

const expect = playwrightExpect.configure({ timeout: 5_000 });
test("release UI regressions on an isolated production database", { timeout: 180_000 }, async (t) => {
  const { base } = await startTestServer(t);
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  async function pageFor(t, viewport = { width: 1440, height: 1000 }) {
    const context = await browser.newContext({ baseURL: base, viewport, locale: "ko-KR", timezoneId: "Asia/Seoul" });
    await context.addInitScript(() => localStorage.setItem("cc-simply-tasks:actor-name", "출시 검수"));
    t.after(() => context.close());
    const page = await context.newPage();
    page.setDefaultTimeout(5_000);
    return page;
  }
  async function create(path, body) {
    const response = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(response.status, 201, await response.clone().text());
    return response.json();
  }

  await t.test("mobile navigation and page controls fit a 390px viewport", async (t) => {
    const page = await pageFor(t, { width: 390, height: 844 });
    for (const path of ["/", "/todos", "/work-items", "/transfer", "/calendar", "/settings"]) {
      await page.goto(path);
      await expect(page.locator("main h1")).toBeVisible();
      await expect.poll(() => page.locator("main").evaluate((el) => el.scrollWidth - el.clientWidth), { message: `${path}: page-level horizontal overflow` }).toBeLessThanOrEqual(1);
      await expect(page.getByRole("link", { name: "설정", exact: true })).toBeInViewport();
    }
    await page.goto("/todos");
    await page.getByRole("button", { name: "TODO 추가", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "새 TODO", exact: true });
    await expect(dialog).toBeInViewport({ ratio: 0.99 });
    await dialog.getByLabel("제목", { exact: true }).fill("긴 제목 ".repeat(40));
    await dialog.getByRole("button", { name: "항목 추가" }).click();
    await dialog.getByPlaceholder("항목 내용").fill("긴 체크리스트 ".repeat(20));
    await expect.poll(() => dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  });

  await t.test("work table detail can be opened and closed with the keyboard", async (t) => {
    const work = await create("/api/work-items", { title: "키보드로 여는 작업" });
    const page = await pageFor(t);
    await page.goto("/work-items");
    const title = page.getByRole("button", { name: work.title, exact: true });
    await expect(title).toBeVisible();
    await title.focus();
    await page.keyboard.press("Enter");
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("heading", { name: work.title, exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(title).toBeFocused();
  });

  await t.test("a late initial TODO response cannot erase a new draft", async (t) => {
    const page = await pageFor(t);
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    t.after(() => release());
    await page.route(/\/api\/todos\?/, async (route) => { await held; await route.continue(); });
    await page.goto("/todos");
    await page.getByRole("button", { name: "TODO 추가", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "새 TODO", exact: true });
    const title = dialog.getByLabel("제목", { exact: true });
    await title.fill("목록이 늦게 와도 유지할 초안");
    const response = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/todos");
    release();
    await response;
    // The response can finish before React commits the parent rerender.
    await expect(page.locator("main")).not.toContainText("불러오는 중");
    await expect(title).toHaveValue("목록이 늦게 와도 유지할 초안");
  });

  await t.test("TODO failure is distinct from empty data and retry recovers", async (t) => {
    const page = await pageFor(t);
    let fail = true;
    await page.route(/\/api\/todos\?/, (route) => fail
      ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "검수용 조회 실패" } }) })
      : route.continue());
    await page.goto("/todos");
    const alert = page.locator("main").getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(page.getByText("등록된 TODO가 없습니다", { exact: true })).toBeHidden();
    fail = false;
    await alert.getByRole("button", { name: "다시 시도" }).click();
    await expect(alert).toBeHidden();
    await expect(page.getByText("조건에 맞는 TODO가 없습니다", { exact: true })).toBeVisible();
  });

  await t.test("calendar failure has a retry and recovers without changing month", async (t) => {
    const page = await pageFor(t);
    let fail = true;
    await page.route(/\/api\/calendar-events\?/, (route) => fail
      ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "검수용 일정 조회 실패" } }) })
      : route.continue());
    await page.goto("/calendar");
    const alert = page.locator("main").getByRole("alert");
    await expect(alert).toBeVisible();
    fail = false;
    await alert.getByRole("button", { name: "다시 시도" }).click();
    await expect(alert).toBeHidden();
    await expect(page.getByRole("button", { name: "이벤트 추가", exact: true }).first()).toBeVisible();
  });

  await t.test("the 51st member is available in management and assignment", async (t) => {
    for (let i = 0; i < 51; i++) await create("/api/team-members", { name: `검수 팀원 ${String(i).padStart(2, "0")}`, role: "WEB_DEV" });
    const page = await pageFor(t);
    await page.goto("/settings");
    await page.getByRole("tab", { name: "팀원", exact: true }).click();
    await expect(page.getByRole("cell", { name: "검수 팀원 50", exact: true })).toBeVisible();
    await page.goto("/work-items");
    await page.getByRole("button", { name: "작업 추가", exact: true }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "미배정", exact: true }).click();
    await page.getByRole("button", { name: "검수 팀원 50", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("button", { name: /검수 팀원 50/ })).toBeVisible();
  });

  await t.test("late TODO search results cannot replace the current filter", async (t) => {
    await create("/api/todos", { title: "검색가 느린 결과" });
    await create("/api/todos", { title: "검색나 최신 결과" });
    const page = await pageFor(t);
    let release, observed, delivered;
    const held = new Promise((resolve) => { release = resolve; });
    const started = new Promise((resolve) => { observed = resolve; });
    const finished = new Promise((resolve) => { delivered = resolve; });
    t.after(() => release());
    await page.route(/\/api\/todos\?/, async (route) => {
      if (new URL(route.request().url()).searchParams.get("title") === "검색가") {
        const response = await route.fetch();
        observed();
        await held;
        await route.fulfill({ response });
        delivered();
      } else await route.continue();
    });
    await page.goto("/todos");
    const search = page.locator("main input[type=text], main input:not([type])").first();
    await search.fill("검색가");
    await started;
    await search.fill("검색나");
    await expect(page.getByRole("button", { name: "검색나 최신 결과", exact: true })).toBeVisible();
    release();
    await finished;
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.getByRole("button", { name: "검색가 느린 결과", exact: true })).toBeHidden();
    await expect(page.getByRole("button", { name: "검색나 최신 결과", exact: true })).toBeVisible();
  });

  await t.test("failed TODO save preserves its draft and retries as a single write", async (t) => {
    const todo = await create("/api/todos", { title: "저장 실패 원본", checklist: [{ content: "기존 항목" }] });
    const page = await pageFor(t);
    let fail = true;
    let writes = 0;
    await page.route(`**/api/todos/${todo.id}`, async (route) => {
      if (route.request().method() === "PATCH") {
        writes++;
        if (fail) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "검수용 저장 실패" } }) });
      }
      await route.continue();
    });
    await page.goto("/todos");
    await page.getByRole("button", { name: todo.title, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("제목", { exact: true }).fill("재시도 후 저장한 제목");
    await dialog.getByRole("button", { name: "항목 추가" }).click();
    await dialog.getByPlaceholder("항목 내용").last().fill("추가 항목 한 번만 저장");
    await dialog.getByLabel("제목", { exact: true }).press("Enter");
    await expect(dialog.getByRole("alert").getByText("검수용 저장 실패", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel("제목", { exact: true })).toHaveValue("재시도 후 저장한 제목");
    const unchanged = await (await fetch(`${base}/api/todos/${todo.id}`)).json();
    assert.equal(unchanged.title, todo.title);
    assert.equal(unchanged.checklist.length, 1);
    fail = false;
    await dialog.getByLabel("제목", { exact: true }).press("Enter");
    await expect(dialog).toBeHidden();
    const saved = await (await fetch(`${base}/api/todos/${todo.id}`)).json();
    assert.equal(saved.title, "재시도 후 저장한 제목");
    assert.equal(saved.checklist.length, 2);
    assert.equal(saved.checklist[0].id, todo.checklist[0].id);
    assert.equal(writes, 2);
  });

  await t.test("calendar counts all pages of transfer work", async (t) => {
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    for (let i = 0; i < 205; i++) await create("/api/work-items", { title: `월 이관 ${i}`, transferDate: `${date}T09:00:00+09:00` });
    const page = await pageFor(t);
    await page.goto("/calendar");
    await expect(page.getByText("205건", { exact: true })).toBeVisible();
  });

  await t.test("a stale work detail response cannot replace the newly selected work", async (t) => {
    const a = await create("/api/work-items", { title: "늦게 도착할 상세 A", order: -100 });
    const b = await create("/api/work-items", { title: "현재 선택한 상세 B", order: -100 });
    const page = await pageFor(t);
    let release, observed, delivered;
    const held = new Promise((resolve) => { release = resolve; });
    const started = new Promise((resolve) => { observed = resolve; });
    const finished = new Promise((resolve) => { delivered = resolve; });
    t.after(() => release());
    await page.route(`**/api/work-items/${a.id}`, async (route) => {
      const response = await route.fetch();
      observed();
      await held;
      await route.fulfill({ response });
      delivered();
    });
    await page.goto("/work-items");
    await page.getByRole("button", { name: a.title, exact: true }).click();
    await started;
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await page.getByRole("button", { name: b.title, exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: b.title, exact: true })).toBeVisible();
    release();
    await finished;
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.getByRole("dialog").getByRole("heading", { name: b.title, exact: true })).toBeVisible();
  });

  await t.test("concurrent TODO edits keep the draft and protect another user's checklist", async (t) => {
    const todo = await create("/api/todos", { title: "동시 편집 원본" });
    const page = await pageFor(t);
    await page.goto("/todos");
    await page.getByRole("button", { name: todo.title, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("제목", { exact: true }).fill("보존할 나의 초안");
    await create(`/api/todos/${todo.id}/checklist`, { content: "다른 사용자가 추가한 항목" });
    await dialog.getByLabel("제목", { exact: true }).press("Enter");
    await expect(dialog.getByRole("alert")).toContainText("다른");
    await expect(dialog.getByLabel("제목", { exact: true })).toHaveValue("보존할 나의 초안");
    const saved = await (await fetch(`${base}/api/todos/${todo.id}`)).json();
    assert.equal(saved.title, todo.title);
    assert.equal(saved.checklist[0].content, "다른 사용자가 추가한 항목");
  });
});
