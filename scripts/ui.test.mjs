import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium, expect as playwrightExpect } from "@playwright/test";
import { startTestServer } from "./test-server.mjs";

// npm run build && node --test scripts/ui.test.mjs
// Install the browser once with: npx playwright install chromium
const expect = playwrightExpect.configure({ timeout: 10_000 });
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

test("browser workflows on a disposable production database", { timeout: 180_000 }, async (t) => {
  const { base, serverLog } = await startTestServer(t);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL: base,
    viewport: { width: 1440, height: 1080 },
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    colorScheme: "light",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 500) errors.push(`${response.status()} ${response.url()}`);
  });
  t.after(async () => {
    await context.close();
    await browser.close();
  });

  async function mutation(route, method, action, status = 200) {
    const responsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === route && response.request().method() === method);
    await action();
    const response = await responsePromise;
    assert.equal(response.status(), status, `${method} ${route}: ${await response.text()}\n${serverLog()}`);
    return response.json();
  }

  async function get(route) {
    const response = await context.request.get(route);
    assert.equal(response.status(), 200);
    return response.json();
  }

  async function datePicker(selector, value) {
    await page.locator(selector).click();
    const field = page.getByPlaceholder("yyyy-mm-dd");
    await expect(field).toBeVisible();
    await field.fill(value);
    await page.getByRole("button", { name: "적용", exact: true }).click();
    await expect(field).toBeHidden();
  }

  async function visibleWithinViewport(locator) {
    await expect(locator).toBeVisible();
    // A drawer is visible while its opening animation still begins off-screen.
    await expect.poll(async () => {
      const box = await locator.boundingBox();
      return Boolean(box && box.width > 0 && box.height > 0 &&
        box.x >= -1 && box.y >= -1 && box.x + box.width <= 1441 && box.y + box.height <= 1081);
    }, { message: "The open overlay must settle inside the viewport" }).toBe(true);
  }

  async function dragWithMouse(source, target) {
    await source.scrollIntoViewIfNeeded();
    await target.scrollIntoViewIfNeeded();
    const from = await source.boundingBox();
    const to = await target.boundingBox();
    assert.ok(from && to, "Both drag endpoints must be rendered");
    const x = from.x + from.width / 2;
    const y = from.y + from.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    // Cross the PointerSensor's eight-pixel activation threshold before moving
    // into the drop target. Real pointer movement exercises CSS transforms.
    await page.mouse.move(x + 12, y + 2, { steps: 4 });
    await page.mouse.move(to.x + to.width / 2, to.y + to.height * 0.7, { steps: 20 });
    await page.mouse.up();
    // @dnd-kit/core's AbstractPointerSensor.detach retains its document-level
    // click stopPropagation listener for 50 ms. Let that intentional guard end
    // before the next independent click; fast local API responses can arrive
    // sooner and otherwise cause a real click to be swallowed by the sensor.
    await page.waitForTimeout(60);
  }

  await t.test("actor registration, settings, members, codes and light/dark themes", async () => {
    await page.goto("/");
    const gate = page.getByRole("dialog", { name: "이름을 입력해주세요" });
    await visibleWithinViewport(gate);
    await gate.getByLabel("표시 이름").fill("브라우저 점검자");
    await gate.getByRole("button", { name: "시작하기" }).click();
    await expect(gate).toBeHidden();

    await page.getByRole("link", { name: "설정", exact: true }).click();
    await page.getByLabel("표시 이름", { exact: true }).fill("업그레이드 UI 점검");
    await mutation("/api/settings", "PATCH", () => page.getByRole("button", { name: "저장", exact: true }).click());
    await expect(page).toHaveTitle(/업그레이드 UI 점검/);
    assert.equal((await get("/api/settings")).service_name, "업그레이드 UI 점검");

    await page.getByRole("tab", { name: "팀원", exact: true }).click();
    await page.getByRole("button", { name: "팀원 추가", exact: true }).first().click();
    const memberDialog = page.getByRole("dialog", { name: "팀원 추가", exact: true });
    await visibleWithinViewport(memberDialog);
    await memberDialog.getByLabel("이름", { exact: true }).fill("UI 담당자");
    await memberDialog.getByLabel("역할").selectOption("WEB_DEV");
    await mutation("/api/team-members", "POST", () => memberDialog.getByRole("button", { name: "추가", exact: true }).click(), 201);
    await expect(memberDialog).toBeHidden();
    await expect(page.getByRole("cell", { name: "UI 담당자", exact: true })).toBeVisible();

    await page.getByRole("tab", { name: "코드 관리", exact: true }).click();
    for (const [heading, dialogName, code, name] of [
      ["작업 분류 코드", "분류 추가", "ui-category", "UI 분류"],
      ["작업 시스템 코드", "시스템 추가", "ui-system", "UI 시스템"],
    ]) {
      const section = page.locator("div.max-w-xl").filter({ has: page.getByRole("heading", { name: heading, exact: true }) });
      await section.getByRole("button", { name: "추가", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: dialogName, exact: true });
      await dialog.getByLabel("코드", { exact: true }).fill(code);
      await dialog.getByLabel("이름", { exact: true }).fill(name);
      await mutation(code === "ui-category" ? "/api/work-categories" : "/api/work-systems", "POST",
        () => dialog.getByRole("button", { name: "저장", exact: true }).click(), 201);
      await expect(dialog).toBeHidden();
      await expect(section.getByRole("cell", { name, exact: true })).toBeVisible();
    }

    await expect(page.locator("html")).toHaveClass(/light/);
    const lightColor = await page.locator("body").evaluate((element) => getComputedStyle(element).backgroundColor);
    await page.getByRole("button", { name: "테마 전환" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect.poll(() => page.locator("body").evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(lightColor);
    await page.getByRole("button", { name: "테마 전환" }).click();
    await expect(page.locator("html")).toHaveClass(/light/);
    await page.reload();
    await expect(page.getByRole("dialog", { name: "이름을 입력해주세요" })).toBeHidden();
    await expect(page.locator("html")).toHaveClass(/light/);
  });

  await t.test("work item views, date picker and TODO Enter/checklist saving", async () => {
    await page.goto("/work-items");
    await page.getByRole("button", { name: "작업 추가", exact: true }).first().click();
    const workDialog = page.getByRole("dialog", { name: "작업 추가", exact: true });
    await visibleWithinViewport(workDialog);
    await workDialog.getByLabel("제목 *", { exact: true }).fill("브라우저에서 만든 작업");
    await workDialog.getByLabel("분류", { exact: true }).selectOption("ui-category");
    await datePicker("#wi-start", today);
    await datePicker("#wi-end", today);
    const work = await mutation("/api/work-items", "POST",
      () => workDialog.getByRole("button", { name: "추가", exact: true }).last().click(), 201);
    await expect(workDialog).toBeHidden();
    for (const name of ["테이블", "칸반", "간트", "테이블"]) {
      const toggle = page.getByRole("button", { name, exact: true });
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByText(work.title, { exact: true }).first()).toBeVisible();
      if (name === "칸반") {
        const card = page.getByRole("button", { name: new RegExp(work.title) });
        const targetColumn = page.locator("section")
          .filter({ has: page.getByText("진행 중", { exact: true }) }).last();
        const moved = await mutation(`/api/work-items/${work.id}`, "PATCH", () => dragWithMouse(card, targetColumn));
        assert.equal(moved.status, "IN_PROGRESS");
        assert.equal((await get(`/api/work-items/${work.id}`)).status, "IN_PROGRESS");
        await expect(targetColumn.getByRole("button", { name: new RegExp(work.title) })).toBeVisible();
      }
    }
    await page.getByText(work.title, { exact: true }).first().click();
    const drawer = page.getByRole("dialog");
    await visibleWithinViewport(drawer);
    await expect(drawer.getByRole("heading", { name: work.title })).toBeVisible();
    await drawer.getByRole("button", { name: "Close", exact: true }).click();
    await expect(drawer).toBeHidden();

    await page.getByRole("link", { name: /할 일/ }).click();
    await page.getByRole("button", { name: "TODO 추가", exact: true }).first().click();
    const todoDialog = page.getByRole("dialog", { name: "새 TODO", exact: true });
    await visibleWithinViewport(todoDialog);
    await todoDialog.getByLabel("제목", { exact: true }).fill("Enter로 저장한 할 일");
    await todoDialog.getByRole("button", { name: "항목 추가", exact: true }).click();
    await todoDialog.getByPlaceholder("항목 내용").fill("체크리스트 기능 확인");
    await todoDialog.getByRole("button", { name: "항목 추가", exact: true }).click();
    await todoDialog.getByLabel("제목", { exact: true }).dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
    await expect(todoDialog).toBeVisible();
    const todo = await mutation("/api/todos", "POST", () => todoDialog.getByLabel("제목", { exact: true }).press("Enter"), 201);
    await expect(todoDialog).toBeHidden();
    assert.equal(todo.checklist.length, 1, "Blank checklist rows must not be saved");
    await page.getByRole("button", { name: todo.title, exact: true }).click();
    const editTodo = page.getByRole("dialog", { name: todo.title, exact: true });
    await editTodo.getByRole("checkbox").check();
    await editTodo.getByLabel("제목", { exact: true }).fill("수정한 할 일");
    await mutation(`/api/todos/${todo.id}`, "PATCH", () => editTodo.getByLabel("제목", { exact: true }).press("Enter"));
    await expect(editTodo).toBeHidden();
    const savedTodo = await get(`/api/todos/${todo.id}`);
    assert.equal(savedTodo.title, "수정한 할 일");
    assert.equal(savedTodo.checklist[0].done, true);
    await expect(page.getByRole("button", { name: "수정한 할 일", exact: true })).toBeVisible();
  });

  await t.test("calendar event creation, backup controls and browser errors", async () => {
    await page.goto("/calendar");
    await page.getByRole("button", { name: "이벤트 추가", exact: true }).first().click();
    const eventDialog = page.getByRole("dialog", { name: "이벤트 추가", exact: true });
    await visibleWithinViewport(eventDialog);
    await eventDialog.getByLabel("제목", { exact: true }).fill("브라우저 일정 점검");
    await eventDialog.getByLabel("종일 일정", { exact: true }).check();
    await datePicker("#ce-start-date", today);
    await datePicker("#ce-end-date", today);
    const event = await mutation("/api/calendar-events", "POST",
      () => eventDialog.getByRole("button", { name: "추가", exact: true }).click(), 201);
    await expect(eventDialog).toBeHidden();
    await expect(page.getByText(event.title, { exact: true }).first()).toBeVisible();
    assert.equal((await get(`/api/calendar-events/${event.id}`)).allDay, true);

    const cells = page.locator(".grid.grid-cols-7 > .group.relative");
    const sourceIndex = await cells.evaluateAll((elements, title) =>
      elements.findIndex((element) => element.textContent.includes(title)), event.title);
    assert.ok(sourceIndex >= 0, "The created event must appear in a day cell");
    // Use the next rendered day, or the previous one at the final grid cell.
    // This also handles the end of a month without relying on duplicate numbers.
    const deltaDays = sourceIndex + 1 < await cells.count() ? 1 : -1;
    const targetCell = cells.nth(sourceIndex + deltaDays);
    const chip = cells.nth(sourceIndex).getByRole("button", { name: new RegExp(event.title) });
    const moved = await mutation(`/api/calendar-events/${event.id}`, "PATCH", () => dragWithMouse(chip, targetCell));
    const shiftedStart = new Date(new Date(event.startDateTime).getTime() + deltaDays * 86_400_000).toISOString();
    const shiftedEnd = new Date(new Date(event.endDateTime).getTime() + deltaDays * 86_400_000).toISOString();
    assert.equal(moved.startDateTime, shiftedStart);
    assert.equal(moved.endDateTime, shiftedEnd);
    const savedEvent = await get(`/api/calendar-events/${event.id}`);
    assert.equal(savedEvent.startDateTime, shiftedStart);
    assert.equal(savedEvent.endDateTime, shiftedEnd);
    await expect(targetCell.getByRole("button", { name: new RegExp(event.title) })).toBeVisible();

    await page.getByRole("link", { name: "설정", exact: true }).click();
    await page.getByRole("tab", { name: "백업", exact: true }).click();
    await expect(page.getByRole("heading", { name: "데이터베이스 백업", exact: true })).toBeVisible();
    await mutation("/api/backup/trigger", "POST", () => page.getByRole("button", { name: "지금 백업", exact: true }).click());
    await expect(page.locator('a[href^="/api/backup/files/"]')).toHaveCount(1);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "현재 DB 다운로드", exact: true }).click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /^backup-.*\.db$/);
    assert.equal(await download.failure(), null);
    const audit = await get(`/api/audit-logs?actorName=${encodeURIComponent("브라우저 점검자")}`);
    assert.ok(audit.items.length > 0);
    assert.deepEqual(errors, [], `Unexpected browser errors:\n${errors.join("\n")}\n${serverLog()}`);
  });
});
