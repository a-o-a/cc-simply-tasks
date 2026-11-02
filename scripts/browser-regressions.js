// Run with Playwright CLI run-code --filename against a DISPOSABLE local DB.
// See docs/RELEASE_REVIEW.md. No Playwright dependency is needed by the app.
async (page) => {
  const origin = new URL(page.url()).origin;
  if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname)) {
    throw new Error("Browser regression checks require a disposable localhost server");
  }
  const results = [];
  const fixtures = [];
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  async function run(name, test) {
    try {
      const detail = await test();
      results.push({ name, passed: true, detail });
    } catch (error) {
      results.push({ name, passed: false, error: error.message });
    }
  }

  await page.evaluate(() => localStorage.setItem("cc-simply-tasks:actor-name", "browser-regression"));
  await run("mobile main width and menu keyboard", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/`);
    await page.getByRole("heading", { name: "홈", exact: true }).waitFor();
    const widths = await page.locator("main").evaluate((main) => ({ viewport: innerWidth, main: main.clientWidth, content: main.scrollWidth }));
    check(widths.main === 390 && widths.content === 390, `Mobile overflow: ${JSON.stringify(widths)}`);
    const menu = page.getByRole("button", { name: "메뉴 열기" });
    await menu.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("dialog").waitFor();
    await page.getByRole("dialog").getByRole("link", { name: "할 일", exact: true }).click();
    await page.getByRole("heading", { name: "할 일", exact: true }).waitFor();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await menu.click();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    check(await menu.evaluate((element) => element === document.activeElement), "Escape did not restore menu focus");
    return widths;
  });

  await run("date validation and keyboard clear", async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${origin}/work-items`);
    await page.getByRole("button", { name: "날짜 선택", exact: true }).click();
    const input = page.getByPlaceholder("yyyy-mm-dd");
    await input.fill("2026-10-21junk");
    await input.press("Enter");
    await page.getByText("yyyy-mm-dd 형식으로 올바른 날짜를 입력하세요", { exact: true }).waitFor({ timeout: 2000 });
    check(await input.isVisible(), "Invalid date was silently truncated and accepted");
    check(await page.getByText("yyyy-mm-dd 형식으로 올바른 날짜를 입력하세요", { exact: true }).isVisible(), "Missing invalid date feedback");
    await input.fill("2026-02-30");
    await input.press("Enter");
    check(await input.isVisible(), "Nonexistent calendar date was accepted");
    await input.fill("2026-10-21");
    await input.press("Enter");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    const clear = page.getByRole("button", { name: "날짜 지우기" });
    await clear.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    check(await page.getByRole("button", { name: "날짜 선택", exact: true }).isVisible(), "Keyboard clear failed");
    check(await page.getByRole("dialog").count() === 0, "Clearing a date opened the picker");
    return "suffix/nonexistent date rejected, valid date accepted, keyboard clear passed";
  });

  await run("mobile work form scroll", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/work-items`);
    await page.getByRole("button", { name: "작업 추가", exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    const bounds = await dialog.boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 200);
    await page.mouse.wheel(0, 1800);
    await page.waitForFunction(() => {
      const description = document.querySelector("#wi-desc").getBoundingClientRect();
      const footer = document.querySelector('[role="dialog"] button[type="submit"]').getBoundingClientRect();
      return description.top > 0 && description.bottom <= footer.top;
    }, null, { timeout: 2000 });
    await dialog.getByRole("button", { name: "취소", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    return "last description field reachable above fixed save footer by wheel scrolling";
  });

  await run("TODO mutation keeps current search", async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const prefix = `browser-race-${Date.now()}`;
    const raceFixtures = [];
    for (const suffix of ["first", "second"]) {
      const response = await page.request.post(`${origin}/api/todos`, { data: { title: `${prefix}-${suffix}` } });
      check(response.status() === 201, "Could not create disposable TODO fixture");
      const fixture = await response.json();
      fixtures.push(fixture);
      raceFixtures.push(fixture);
    }
    const [first, second] = raceFixtures;
    let releasePatch;
    let patchStarted;
    const started = new Promise((resolve) => { patchStarted = resolve; });
    const release = new Promise((resolve) => { releasePatch = resolve; });
    const pattern = `${origin}/api/todos/${first.id}`;
    await page.route(pattern, async (route) => {
      if (route.request().method() === "PATCH") {
        patchStarted();
        await release;
      }
      await route.continue();
    });
    try {
      await page.goto(`${origin}/todos`);
      const search = page.getByRole("textbox", { name: "할 일 제목 검색" });
      const firstSearch = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/todos" && new URL(response.url()).searchParams.get("title") === first.title);
      await search.fill(first.title);
      await firstSearch;
      await page.getByRole("checkbox", { name: `${first.title} 완료`, exact: true }).check();
      await started;
      const secondSearch = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/todos" && new URL(response.url()).searchParams.get("title") === second.title);
      await search.fill(second.title);
      await secondSearch;
      await page.getByRole("button", { name: second.title, exact: true }).waitFor();
      const refreshed = page.waitForResponse((response) => response.request().method() === "GET" && new URL(response.url()).pathname === "/api/todos");
      releasePatch();
      const response = await refreshed;
      const actualFilter = new URL(response.url()).searchParams.get("title");
      check(actualFilter === second.title, `Stale filter restored after PATCH: ${actualFilter}`);
      await page.getByRole("button", { name: second.title, exact: true }).waitFor();
      return "delayed PATCH completed after a new search; current search preserved";
    } finally {
      releasePatch();
      await page.unroute(pattern);
    }
  });

  await run("long TODO title keeps mobile actions visible", async () => {
    const title = `browser-long-${Date.now()}-${"긴제목검수".repeat(48)}`;
    const response = await page.request.post(`${origin}/api/todos`, { data: {
      title, checklist: Array.from({ length: 20 }, (_, index) => ({ content: `긴 목록 항목 ${index + 1}` })),
    } });
    check(response.status() === 201, "Could not create long TODO fixture");
    fixtures.push(await response.json());
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto(`${origin}/todos`);
    const item = page.getByRole("button", { name: title, exact: true });
    await item.waitFor();
    const itemBounds = await item.boundingBox();
    check(itemBounds.width >= 100, `TODO title only has ${itemBounds.width}px`);
    await item.click();
    const dialog = page.getByRole("dialog");
    const heading = dialog.getByRole("heading", { name: title, exact: true });
    await heading.waitFor();
    const headingBounds = await heading.boundingBox();
    const cancel = dialog.getByRole("button", { name: "취소", exact: true });
    const cancelBounds = await cancel.boundingBox();
    check(headingBounds.height <= 60 && cancelBounds.y >= 0 && cancelBounds.y + cancelBounds.height <= 568, "Long title pushes save/cancel outside the viewport");
    await page.mouse.move(150, 300);
    await page.mouse.wheel(0, 3000);
    await dialog.getByRole("textbox", { name: "체크리스트 내용" }).last().scrollIntoViewIfNeeded();
    await cancel.click();
    await dialog.waitFor({ state: "hidden" });
    return { titleWidth: itemBounds.width, headerHeight: headingBounds.height, footerBottom: cancelBounds.y + cancelBounds.height };
  });

  for (const fixture of fixtures) await page.request.delete(`${origin}/api/todos/${fixture.id}`);
  console.log(JSON.stringify({ origin, results }, null, 2));
  check(results.every((result) => result.passed), `Browser regression checks failed: ${JSON.stringify(results)}`);
  return { origin, results };
}
