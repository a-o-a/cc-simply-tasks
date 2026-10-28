import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client/node";
import { chromium, expect as playwrightExpect } from "@playwright/test";
import { startTestServer } from "./test-server.mjs";

const expect = playwrightExpect.configure({ timeout: 5_000 });

test("long work activity histories remain accessible", { timeout: 90_000 }, async (t) => {
  const { base, directory } = await startTestServer(t);
  const sqlite = createClient({ url: pathToFileURL(path.join(directory, "smoke.db")).href });
  const timestamp = Date.parse("2026-10-28T09:00:00+09:00");
  try {
    await sqlite.execute({
      sql: 'INSERT INTO WorkItem(id,title,createdAt,updatedAt) VALUES (?,?,?,?)',
      args: ["activity-work", "오래된 변경 이력 검수", timestamp, timestamp + 101],
    });
    await sqlite.batch(Array.from({ length: 102 }, (_, index) => ({
      sql: "INSERT INTO AuditLog(id,entityType,entityId,action,actorName,afterJson,createdAt) VALUES (?,?,?,?,?,?,?)",
      args: [`activity-${index}`, "WorkItem", "activity-work", index ? "UPDATE" : "CREATE", index ? `수정자 ${index}` : "원본 등록자", JSON.stringify({ note: `변경 기록 ${index}` }), timestamp + index],
    })), "write");
  } finally {
    sqlite.close();
  }
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const artifactDirectory = process.env.RELEASE_UI_ARTIFACT_DIR;
  async function screenshot(page, name) {
    if (!artifactDirectory) return;
    await mkdir(artifactDirectory, { recursive: true });
    await page.evaluate(async () => {
      const animations = document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity);
      await Promise.all(animations.map((animation) => animation.finished.catch(() => {})));
    });
    await page.screenshot({ path: path.join(artifactDirectory, name) });
  }
  async function openWork(t, viewport = { width: 1440, height: 1000 }) {
    const context = await browser.newContext({ baseURL: base, viewport, locale: "ko-KR", timezoneId: "Asia/Seoul" });
    t.after(() => context.close());
    await context.addInitScript(() => localStorage.setItem("cc-simply-tasks:actor-name", "활동 검수"));
    const page = await context.newPage();
    page.setDefaultTimeout(5_000);
    await page.goto("/work-items");
    await page.getByRole("button", { name: "오래된 변경 이력 검수", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "오래된 변경 이력 검수", exact: true })).toBeVisible();
    return page;
  }

  await t.test("the creator remains visible after more than 100 edits", async (t) => {
    const page = await openWork(t);
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("원본 등록자", { exact: true })).toBeVisible();
    await expect(dialog.getByText("수정자 101", { exact: true })).toBeVisible();
    await screenshot(page, "after-activity-creator-desktop.png");
  });

  await t.test("all activity pages are reachable without duplicate entries on mobile", async (t) => {
    const page = await openWork(t, { width: 390, height: 844 });
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("tab", { name: "활동", exact: true }).click();
    await expect(dialog.locator("ol > li")).toHaveCount(50);
    const more = dialog.getByRole("button", { name: "더 보기", exact: true });
    await expect(more).toBeVisible();
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(dialog.locator("ol > li")).toHaveCount(100);
    await more.click();
    await expect(dialog.locator("ol > li")).toHaveCount(102);
    await expect(dialog.getByText("원본 등록자", { exact: true })).toBeVisible();
    await expect(more).toBeHidden();
    assert.equal(new Set(await dialog.locator("ol > li pre").allTextContents()).size, 102);
    assert.ok(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
    await dialog.getByText("원본 등록자", { exact: true }).scrollIntoViewIfNeeded();
    await screenshot(page, "after-activity-mobile.png");
  });

  await t.test("initial and subsequent activity failures can retry without losing visible entries", async (t) => {
    const page = await openWork(t);
    const dialog = page.getByRole("dialog");
    let failure = "initial";
    await page.route("**/api/audit-logs?**", async (route) => {
      const query = new URL(route.request().url()).searchParams;
      if (!query.get("action") && (failure === "initial" || (failure === "next" && query.has("cursor")))) {
        return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "검수용 활동 조회 실패" } }) });
      }
      await route.continue();
    });
    await dialog.getByRole("tab", { name: "활동", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("검수용 활동 조회 실패");
    await expect(dialog.getByText("기록된 활동이 없습니다.", { exact: true })).toBeHidden();
    failure = "next";
    await dialog.getByRole("button", { name: "다시 시도", exact: true }).click();
    await expect(dialog.locator("ol > li")).toHaveCount(50);
    await dialog.getByRole("button", { name: "더 보기", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("검수용 활동 조회 실패");
    await expect(dialog.locator("ol > li")).toHaveCount(50);
    await screenshot(page, "after-activity-retry.png");
    failure = null;
    await dialog.getByRole("button", { name: "다시 시도", exact: true }).click();
    await expect(dialog.locator("ol > li")).toHaveCount(100);
    await expect(dialog.getByRole("alert")).toBeHidden();
  });

  await t.test("deleting a work item blocks dismissal and duplicate deletion until the request settles", async (t) => {
    const page = await openWork(t);
    let release;
    let started;
    const held = new Promise((resolve) => { release = resolve; });
    const requested = new Promise((resolve) => { started = resolve; });
    t.after(() => release());
    let requests = 0;
    await page.route("**/api/work-items/activity-work", async (route) => {
      if (route.request().method() !== "DELETE") return route.continue();
      requests++;
      started();
      await held;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "검수용 삭제 실패" } }) });
    });
    await page.getByRole("dialog").getByRole("button", { name: "삭제", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "작업 삭제", exact: true });
    await confirmation.getByRole("button", { name: "삭제", exact: true }).click();
    await requested;
    await page.keyboard.press("Escape");
    await expect(confirmation).toBeVisible();
    await expect(confirmation.getByRole("button", { name: "취소", exact: true })).toBeDisabled();
    await expect(confirmation.getByRole("button", { name: "삭제 중…", exact: true })).toBeDisabled();
    assert.equal(requests, 1);
    await screenshot(page, "after-work-delete-pending.png");
    release();
    await expect(confirmation.getByRole("alert")).toContainText("검수용 삭제 실패");
    await expect(confirmation.getByRole("button", { name: "삭제", exact: true })).toBeEnabled();
    await confirmation.getByRole("button", { name: "취소", exact: true }).click();
    await expect(confirmation).toBeHidden();
    assert.equal((await fetch(`${base}/api/work-items/activity-work`)).status, 200);
  });
});
