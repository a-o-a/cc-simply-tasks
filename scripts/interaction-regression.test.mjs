import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium, expect as playwrightExpect } from "@playwright/test";
import { startTestServer } from "./test-server.mjs";

const expect = playwrightExpect.configure({ timeout: 5_000 });
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

test("release interactions preserve drafts and keep every event reachable", { timeout: 120_000 }, async (t) => {
  const { base } = await startTestServer(t);
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  async function pageFor(t, options = {}) {
    const context = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 1000 }, timezoneId: "Asia/Seoul", ...options });
    await context.addInitScript(() => localStorage.setItem("cc-simply-tasks:actor-name", "출시 검수"));
    t.after(() => context.close());
    return context.newPage();
  }
  async function create(path, body) {
    const response = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(response.status, 201, await response.clone().text());
    return response.json();
  }

  for (const [name, path, endpoint, titleLabel] of [
    ["작업 추가", "/work-items", "/api/work-items", "제목 *"],
    ["이벤트 추가", "/calendar", "/api/calendar-events", "제목"],
  ]) {
    await t.test(`${name}: pending save cannot close the form or accept a replacement draft`, async (t) => {
      const page = await pageFor(t);
      let release, observed;
      const held = new Promise((resolve) => { release = resolve; });
      const started = new Promise((resolve) => { observed = resolve; });
      let writes = 0;
      await page.route(`**${endpoint}`, async (route) => {
        if (route.request().method() === "POST") {
          writes++;
          observed();
          await held;
        }
        await route.continue().catch(() => {});
      });
      t.after(() => release());
      await page.goto(path);
      await page.getByRole("button", { name, exact: true }).first().click();
      const dialog = page.getByRole("dialog", { name, exact: true });
      await dialog.getByLabel(titleLabel, { exact: true }).fill(`${name} 저장 중 초안`);
      await dialog.getByRole("button", { name: "추가", exact: true }).last().click();
      await started;
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel(titleLabel, { exact: true })).toBeDisabled();
      await expect(dialog.getByRole("button", { name: "취소", exact: true })).toBeDisabled();
      release();
      await expect(dialog).toBeHidden();
      assert.equal(writes, 1);
    });

    await t.test(`${name}: failed save preserves input and permits retry`, async (t) => {
      const page = await pageFor(t);
      let fail = true;
      await page.route(`**${endpoint}`, (route) => route.request().method() === "POST" && fail
        ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "검수용 저장 실패" } }) })
        : route.continue());
      await page.goto(path);
      await page.getByRole("button", { name, exact: true }).first().click();
      const dialog = page.getByRole("dialog", { name, exact: true });
      await dialog.getByLabel(titleLabel, { exact: true }).fill(`${name} 재시도 초안`);
      await dialog.getByRole("button", { name: "추가", exact: true }).last().click();
      await expect(dialog.getByRole("alert")).toContainText("검수용 저장 실패");
      await expect(dialog.getByLabel(titleLabel, { exact: true })).toHaveValue(`${name} 재시도 초안`);
      fail = false;
      await dialog.getByRole("button", { name: "추가", exact: true }).last().click();
      await expect(dialog).toBeHidden();
    });
  }

  await t.test("mobile ticket controls remain readable and inside the form", async (t) => {
    await create("/api/work-systems", { code: "MOBILE_QA", name: "긴 시스템 이름 ".repeat(8) });
    const page = await pageFor(t, { viewport: { width: 390, height: 844 } });
    await page.goto("/work-items");
    await page.getByRole("button", { name: "작업 추가", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "작업 추가", exact: true });
    await dialog.getByRole("button", { name: "추가", exact: true }).first().click();
    const ticket = dialog.getByPlaceholder("티켓번호 (선택)");
    await ticket.scrollIntoViewIfNeeded();
    const box = await ticket.boundingBox();
    assert.ok(box && box.width >= 150, `ticket input must be usable: ${JSON.stringify(box)}`);
    await expect.poll(() => dialog.locator("form").evaluate((el) => Math.max(...[el, ...el.querySelectorAll("div")].map((node) => node.scrollWidth - node.clientWidth)))).toBeLessThanOrEqual(1);
    await expect(dialog.getByRole("combobox", { name: "연동 시스템 1" })).toBeVisible();
  });

  await t.test("event form remains reachable on a short mobile screen", async (t) => {
    const page = await pageFor(t, { viewport: { width: 390, height: 667 } });
    await page.goto("/calendar");
    await page.getByRole("button", { name: "이벤트 추가", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "이벤트 추가", exact: true });
    await expect(dialog).toBeInViewport({ ratio: 0.99 });
    await dialog.getByLabel("제목", { exact: true }).fill("작은 화면 일정");
    await dialog.getByRole("button", { name: "추가", exact: true }).click();
    await expect(dialog).toBeHidden();
  });

  await t.test("each holiday can be opened with the keyboard, edited and deleted", async (t) => {
    for (const title of ["개별 휴일 A", "개별 휴일 B"]) await create("/api/calendar-events", {
      title, category: "HOLIDAY", allDay: true,
      startDateTime: `${today}T00:00:00+09:00`, endDateTime: new Date(Date.parse(`${today}T00:00:00+09:00`) + 86400000).toISOString(),
    });
    const page = await pageFor(t);
    await page.goto("/calendar");
    const holiday = page.getByRole("button", { name: "개별 휴일 A", exact: true });
    await expect(holiday).toBeVisible();
    await holiday.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "이벤트 수정", exact: true });
    await dialog.getByLabel("제목", { exact: true }).fill("수정한 휴일 A");
    await dialog.getByRole("button", { name: "저장", exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: "수정한 휴일 A", exact: true }).click();
    await dialog.getByRole("button", { name: "삭제", exact: true }).click();
    await page.getByRole("dialog", { name: "이벤트 삭제", exact: true }).getByRole("button", { name: "삭제", exact: true }).click();
    await expect(page.getByRole("button", { name: "수정한 휴일 A", exact: true })).toBeHidden();
    await expect(page.getByRole("button", { name: "개별 휴일 B", exact: true })).toBeVisible();
  });

  await t.test("transfer titles support keyboard detail and KST weekdays in a UTC browser", async (t) => {
    const work = await create("/api/work-items", { title: "이관 키보드 작업", transferDate: `${today}T00:00:00+09:00` });
    const page = await pageFor(t, { timezoneId: "UTC" });
    await page.goto("/transfer");
    const weekday = ["일", "월", "화", "수", "목", "금", "토"][new Date(`${today}T00:00:00Z`).getUTCDay()];
    await expect(page.getByText(`${today} (${weekday})`, { exact: true })).toBeVisible();
    const title = page.getByRole("button", { name: work.title, exact: true });
    await title.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog").getByRole("heading", { name: work.title, exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(title).toBeFocused();
  });
});
