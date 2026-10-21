/*
 * Add realistic, repeatable sample data through the app's normal HTTP APIs.
 * Only a localhost server backed by a temporary QA database is permitted.
 *
 * node scripts/seed-demo.cjs --url http://127.0.0.1:3036 \
 *   --db /private/tmp/cc-build-size-8J4fGN/db/qa.db --confirm-demo-data
 *
 * Never deletes/updates rows. Re-running resumes the same 2,000 work items,
 * 60 todos and 36 calendar events, identified by stable sample markers.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { performance } = require("node:perf_hooks");
const { createClient } = require("@libsql/client");

const PREFIX = "DEMO-20261021";
const ANCHOR = Date.parse("2026-10-21T00:00:00+09:00");
const DAY = 86_400_000;
const OUTPUT = path.resolve(__dirname, "../output/playwright/seed-data-summary.json");
const TABLES = ["TeamMember", "WorkCategory", "WorkSystem", "WorkItem", "WorkTicket", "Todo", "TodoChecklist", "CalendarEvent", "CalendarEventMember", "Setting", "AuditLog"];
const STATUS_COUNTS = { WAITING: 240, IN_PROGRESS: 320, INTERNAL_TEST: 200, BUSINESS_TEST: 140, QA_TEST: 140, TRANSFER_READY: 160, TRANSFERRED: 680, HOLDING: 120 };
const MEMBERS = [
  ["김서연", "WEB_DEV"], ["이도윤", "WEB_DEV"], ["박지호", "APP_DEV"],
  ["최하은", "UI_DEV"], ["정민준", "WEB_DEV"], ["강수빈", "PLANNING"],
  ["윤지우", "DESIGN"], ["장유진", "APP_DEV"], ["임현우", "WEB_DEV"],
  ["한예린", "UI_DEV"], ["오준서", "ETC"], ["송다은", "PLANNING"],
];
const CATEGORIES = [
  ["DEMO_IMPROVE", "기능 개선"], ["DEMO_BUG", "오류 수정"],
  ["DEMO_NEW", "신규 개발"], ["DEMO_OPERATE", "운영 지원"],
  ["DEMO_DATA", "데이터 정비"], ["DEMO_LINK", "시스템 연동"],
];
const DOMAINS = [
  { code: "DEMO_CRM", name: "고객관리", department: "고객지원팀", features: ["고객 상담 이력", "중복 고객 병합", "고객 등급 조회", "문의 유형 분류", "상담 배정", "고객 동의 이력"] },
  { code: "DEMO_BILLING", name: "정산·결제", department: "재무팀", features: ["월별 매출 정산", "결제 취소 내역", "세금계산서 발행", "미수금 현황", "수수료 계산", "입금 확인"] },
  { code: "DEMO_ORDER", name: "주문관리", department: "영업운영팀", features: ["주문 상태 변경", "묶음 배송 요청", "반품 접수", "주문 상세 조회", "예약 주문 처리", "주문 취소 사유"] },
  { code: "DEMO_STOCK", name: "재고관리", department: "물류운영팀", features: ["창고별 재고 조회", "입출고 내역", "안전 재고 알림", "재고 실사 결과", "로케이션 이동", "품절 상품 처리"] },
  { code: "DEMO_HR", name: "인사·근태", department: "인사팀", features: ["휴가 잔여일 조회", "근무 일정 등록", "조직 정보 동기화", "교육 이수 현황", "출장 신청", "부서별 근태 집계"] },
  { code: "DEMO_PORTAL", name: "업무포털", department: "경영지원팀", features: ["공지사항 검색", "문서 권한 신청", "결재함 필터", "개인 메뉴 설정", "전자결재 첨부", "업무 대시보드"] },
  { code: "DEMO_REPORT", name: "통계·리포트", department: "사업기획팀", features: ["주간 실적 리포트", "기간별 통계 조회", "지표 엑셀 내보내기", "대시보드 집계", "목표 대비 실적", "보고서 예약 발송"] },
  { code: "DEMO_CONNECT", name: "외부연동", department: "플랫폼운영팀", features: ["파트너 주문 수신", "배송 상태 연동", "상품 정보 동기화", "외부 응답 재처리", "연동 오류 이력", "배치 실행 모니터링"] },
];
const ACTIONS = ["검색 조건 개선", "예외 처리 보완", "처리 결과 표시 개선", "일괄 처리 추가", "누락 데이터 보정", "조회 속도 점검", "알림 문구 정리", "상세 내역 확장", "중복 요청 방지", "운영 절차 반영"];

function options() {
  const args = process.argv.slice(2);
  const parsed = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--confirm-demo-data") parsed.confirm = true;
    else if ((arg === "--url" || arg === "--db") && args[i + 1]) parsed[arg.slice(2)] = args[++i];
    else throw new Error(`지원하지 않는 옵션: ${arg}`);
  }
  assert.equal(Number(process.versions.node.split(".")[0]), 22, "Node.js 22에서 실행해 주세요.");
  assert.ok(parsed.confirm && parsed.url && parsed.db, "--url, --db, --confirm-demo-data를 명시해 주세요.");
  const url = new URL(parsed.url);
  assert.ok(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname), "HTTP localhost 서버만 허용합니다.");
  assert.ok(!url.username && !url.password && url.pathname === "/" && !url.search && !url.hash, "서버의 기본 URL만 입력해 주세요.");
  const dbPath = fs.realpathSync(parsed.db);
  assert.match(dbPath, /^\/private\/tmp\/cc-build-size-[A-Za-z0-9_-]+\/db\/qa\.db$/, "임시 cc-build-size 검수용 qa.db만 허용합니다.");
  assert.ok(fs.statSync(dbPath).isFile(), "검수 DB 파일이 필요합니다.");
  return { baseUrl: url.origin, dbPath };
}

function iso(day, hour = 0) { return new Date(ANCHOR + day * DAY + hour * 3_600_000).toISOString(); }
function marker(kind, index) { return `[${PREFIX.toLowerCase()}-${kind}-${String(index + 1).padStart(3, "0")}]`; }
function tally(rows, key) {
  return rows.reduce((counts, row) => { counts[row[key]] = (counts[row[key]] ?? 0) + 1; return counts; }, {});
}
function retryable(error) {
  return error.retryable === true || ["TypeError", "TimeoutError", "AbortError"].includes(error.name);
}

async function main() {
  const { baseUrl, dbPath } = options();
  const sql = createClient({ url: pathToFileURL(dbPath).href });
  const started = performance.now();
  const added = { members: 0, categories: 0, systems: 0, workItems: 0, todos: 0, events: 0 };
  const requestMs = [];
  let recoveredPosts = 0;
  let retries = 0;
  const readSql = async (statement, args = []) => {
    assert.match(statement, /^(SELECT\b|PRAGMA (integrity_check|foreign_key_check)\b)/i);
    return (await sql.execute({ sql: statement, args })).rows;
  };
  async function request(route, method = "GET", body) {
    const mark = performance.now();
    try {
      const response = await fetch(`${baseUrl}${route}`, {
        method, redirect: "error", signal: AbortSignal.timeout(20_000),
        headers: { "Content-Type": "application/json", "x-actor-name": encodeURIComponent("검수 샘플 데이터"), "User-Agent": "cc-simply-tasks-local-demo-seed/1" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      if (!response.ok) {
        const error = new Error(`${method} ${route}: ${response.status} ${text.slice(0, 800)}`);
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      return JSON.parse(text);
    } finally { requestMs.push(performance.now() - mark); }
  }
  async function get(route) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try { return await request(route); }
      catch (error) {
        if (!retryable(error) || attempt === 3) throw error;
        retries += 1;
        await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt));
      }
    }
  }
  async function pages(route) {
    const items = [];
    const cursors = new Set();
    let cursor;
    let pageCount = 0;
    do {
      const url = new URL(route, baseUrl);
      url.searchParams.set("pageSize", "200");
      if (cursor) url.searchParams.set("cursor", cursor);
      const page = await get(`${url.pathname}${url.search}`);
      assert.ok(Array.isArray(page.items), `${route}: items 배열이 필요합니다.`);
      items.push(...page.items);
      pageCount += 1;
      cursor = page.nextCursor;
      if (cursor) {
        assert.ok(!cursors.has(cursor), `${route}: 반복된 페이지 커서`);
        cursors.add(cursor);
      }
      assert.ok(pageCount < 1000, "페이지 조회 제한 초과");
    } while (cursor);
    assert.equal(new Set(items.map((item) => item.id)).size, items.length, `${route}: 중복 ID`);
    return { items, pageCount };
  }
  async function post(route, body, recover, table, counter) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const row = await request(route, "POST", body);
        const sameFile = await readSql(`SELECT id FROM "${table}" WHERE id = ?`, [row.id]);
        assert.equal(sameFile.length, 1, "API 서버와 지정한 검수 DB가 다릅니다. 즉시 중단합니다.");
        added[counter] += 1;
        return row;
      } catch (error) {
        if (!retryable(error) || attempt === 3) throw error;
        // A timed-out POST may already be committed. Resolve its stable marker
        // before another write, so a restart/network failure cannot duplicate it.
        await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt));
        const existing = await recover();
        if (existing) {
          assert.equal((await readSql(`SELECT id FROM "${table}" WHERE id = ?`, [existing.id])).length, 1);
          added[counter] += 1;
          recoveredPosts += 1;
          return existing;
        }
        retries += 1;
      }
    }
  }

  try {
    const before = {};
    for (const table of TABLES) before[table] = await readSql(`SELECT * FROM "${table}"`);
    const baselineStats = await get("/api/db-stats");
    for (const table of baselineStats.tables) assert.equal(table.count, before[table.name].length, `API/DB 현황 불일치: ${table.name}`);
    const baselineWorkCount = (await get("/api/work-items/count")).total;
    const members = (await pages("/api/team-members")).items;
    const categories = (await get("/api/work-categories")).items;
    const systems = (await get("/api/work-systems")).items;
    const initialWork = (await pages("/api/work-items?scope=all")).items;
    const workByNumber = new Map(initialWork.map((row) => [row.requestNumber, row]));
    const todoRows = (await pages("/api/todos?include=checklist")).items;
    const eventRange = `/api/calendar-events?${new URLSearchParams({ from: iso(-200), to: iso(120) })}`;
    const events = (await get(eventRange)).items;
    assert.equal(initialWork.length, baselineWorkCount);
    console.log(`검수 DB 확인: ${dbPath}; 기존 작업 ${baselineWorkCount}건. 순차 API 생성 시작.`);

    const demoMembers = [];
    for (const [name, role] of MEMBERS) {
      const existing = members.find((row) => row.name === name);
      const created = existing ?? await post("/api/team-members", { name, role }, async () => (await pages("/api/team-members")).items.find((row) => row.name === name), "TeamMember", "members");
      demoMembers.push(created);
      if (!existing) members.push(created);
    }
    for (const [code, name] of CATEGORIES) {
      if (!categories.some((row) => row.code === code)) categories.push(await post("/api/work-categories", { code, name }, async () => (await get("/api/work-categories")).items.find((row) => row.code === code), "WorkCategory", "categories"));
    }
    for (const { code, name } of DOMAINS) {
      if (!systems.some((row) => row.code === code)) systems.push(await post("/api/work-systems", { code, name }, async () => (await get("/api/work-systems")).items.find((row) => row.code === code), "WorkSystem", "systems"));
    }

    function workPayload(i) {
      const domain = DOMAINS[i % DOMAINS.length];
      const feature = domain.features[Math.floor(i / DOMAINS.length) % domain.features.length];
      const action = ACTIONS[Math.floor(i / 48) % ACTIONS.length];
      const cycle = Math.floor(i / 480) + 1;
      const slot = i % 100;
      const status = slot < 12 ? "WAITING" : slot < 28 ? "IN_PROGRESS" : slot < 38 ? "INTERNAL_TEST" : slot < 45 ? "BUSINESS_TEST" : slot < 52 ? "QA_TEST" : slot < 60 ? "TRANSFER_READY" : slot < 94 ? "TRANSFERRED" : "HOLDING";
      const completed = status === "TRANSFERRED";
      const waiting = status === "WAITING";
      const transferredDay = -1 - ((i * 7) % 165);
      const endDay = completed ? transferredDay - 1 : waiting ? 4 + (i % 24) : -6 + (i % 25);
      const startDay = completed ? endDay - 3 - (i % 18) : waiting ? 1 + (i % 3) : endDay - 5 - (i % 20);
      const scenario = ["기존 조건으로 재조회할 때", "여러 부서 자료를 한 번에 처리할 때", "담당자가 바뀐 뒤 내용을 확인할 때", "월말 정산 기간에 요청이 몰릴 때"][i % 4];
      const description = [
        `배경\n${domain.department}에서 ${feature} 업무 중 ${scenario} 수작업 확인이 필요하다는 요청이 접수되었습니다.`,
        `변경 범위\n${feature}의 ${action}를 진행합니다. 현재 사용자 입력과 처리 이력은 보존하고, 빈 값·중복 값·긴 이름이 포함된 자료를 함께 확인합니다.`,
        "완료 기준\n일반 처리와 잘못된 입력에서 안내가 표시되고, 실패 후 같은 조건으로 다시 시도할 수 있어야 합니다. 담당 부서 확인 후 이관 체크리스트와 운영 문서를 갱신합니다.",
        ...(i % 20 === 0 ? ["상세 검토 항목\n" + Array.from({ length: 12 }, (_, n) => `${n + 1}. ${["조회 조건 유지", "빈 결과 안내", "권한별 표시", "이전 이력 대조", "중복 실행 확인", "장문 줄바꿈"][n % 6]}: 운영 담당자와 실제 업무 자료를 기준으로 결과를 확인하고, 예외 건은 원인을 기록한 후 재처리합니다.`).join("\n")] : []),
      ].join("\n\n");
      return {
        title: `${feature} ${action}${cycle > 1 ? ` · ${cycle}차 운영 반영` : ""}`,
        description,
        additionalNotes: i % 7 === 0 ? "관련 부서 확인이 필요한 항목입니다. 이관 전 점검 결과와 재현 조건을 담당자 메모에 남겨 주세요." : i % 11 === 0 ? "모바일 환경에서도 긴 이름과 숫자 목록이 잘리지 않는지 확인합니다." : null,
        category: CATEGORIES[Math.floor(i / 8) % CATEGORIES.length][0], status,
        priority: i % 10 < 2 ? "HIGH" : i % 10 >= 8 ? "LOW" : "NORMAL",
        order: i,
        assigneeId: !completed && i % 8 === 0 ? null : demoMembers[(i * 5 + Math.floor(i / 12)) % demoMembers.length].id,
        startDate: waiting && i % 5 === 0 ? null : iso(startDay),
        endDate: waiting && i % 7 === 0 ? null : iso(endDay),
        transferDate: completed ? iso(transferredDay) : status === "TRANSFER_READY" ? iso(1 + i % 14) : null,
        requestType: ["운영 개선", "사용자 문의", "정기 점검", "신규 요청", "장애 후속 조치"][i % 5],
        requestor: `${domain.department} ${["이수정", "박정우", "김하린", "정우진", "최다연"][Math.floor(i / 8) % 5]}`,
        requestNumber: `${PREFIX}-${String(i + 1).padStart(4, "0")}`,
        requestContent: `${feature} 관련 현업 요청입니다. ${scenario} 처리 결과를 쉽게 확인할 수 있도록 ${action}를 요청합니다. ${i % 9 === 0 ? "월말 업무 마감 전에 반영이 필요하며, 일정 변경 시 담당 부서와 조율해 주세요." : "변경된 화면과 운영 절차는 담당 부서가 함께 확인할 예정입니다."}`,
        tickets: i % 20 < 3 ? [] : [
          { systemName: domain.code, ticketNumber: `${domain.code.replace("DEMO_", "")}-2026-${String(i + 1001)}` },
          ...(i % 20 >= 17 ? [{ systemName: DOMAINS[(i + 3) % DOMAINS.length].code, ticketNumber: `LINK-2026-${String(i + 3001)}` }] : []),
        ],
      };
    }

    for (let i = 0; i < 2000; i += 1) {
      const payload = workPayload(i);
      if (!workByNumber.has(payload.requestNumber)) {
        const row = await post("/api/work-items", payload, async () => (await pages(`/api/work-items?scope=all&requestNumber=${encodeURIComponent(payload.requestNumber)}`)).items.find((item) => item.requestNumber === payload.requestNumber), "WorkItem", "workItems");
        workByNumber.set(payload.requestNumber, row);
      }
      if ((i + 1) % 200 === 0) console.log(`작업 ${i + 1}/2000 확인 (이번 실행 추가 ${added.workItems}건, ${(performance.now() - started).toFixed(0)}ms)`);
    }

    const checklistTexts = ["요청 부서와 범위 확인", "관련 작업과 티켓 연결 확인", "예외 입력 및 빈 결과 점검", "모바일 화면과 키보드 조작 확인", "담당자 검토 의견 반영", "이관 체크리스트 작성", "운영 문서 링크 확인", "배포 후 확인 항목 공유"];
    for (let i = 0; i < 60; i += 1) {
      const tag = marker("todo", i);
      if (todoRows.some((row) => row.note?.includes(tag))) continue;
      const domain = DOMAINS[i % 8];
      const done = i % 5 === 0;
      const row = await post("/api/todos", {
        title: `${domain.name} ${["주간 운영 점검", "이관 전 확인 사항", "현업 요청 정리", "회귀 테스트 준비", "월말 자료 대조", "운영 가이드 보완", "테스트 계정 자료 준비", "요청 부서 회신 확인"][Math.floor(i / 8)]}`,
        note: `${tag}\n${domain.department}와 확인할 업무 메모입니다. 관련 작업을 정리하고 처리 결과를 공유합니다.${i % 10 === 0 ? "\n\n" + "자료가 없는 경우 안내 문구를 확인하고, 긴 제목과 여러 담당자가 있는 항목도 함께 점검합니다. ".repeat(15) : ""}`,
        status: done ? "DONE" : "OPEN", dueDate: i % 9 === 0 ? null : iso(done ? -1 - i % 12 : -5 + i % 25, 17),
        order: i, assigneeId: i % 7 === 0 ? null : demoMembers[i % 12].id,
        checklist: checklistTexts.slice(0, 3 + i % 6).map((content, n) => ({ content, order: n, done: done || n < i % 3, assigneeId: n % 3 === 0 ? demoMembers[(i + n) % 12].id : null })),
      }, async () => (await pages("/api/todos?include=checklist")).items.find((item) => item.note?.includes(tag)), "Todo", "todos");
      todoRows.push(row);
    }
    for (let i = 0; i < 36; i += 1) {
      const tag = marker("event", i);
      if (events.some((row) => row.note?.includes(tag))) continue;
      const day = -14 + i;
      const category = i % 12 === 0 ? "HOLIDAY" : i % 6 === 0 ? "ABSENCE" : i % 5 === 0 ? "ETC" : "WORK";
      const allDay = category === "ABSENCE" || category === "HOLIDAY" || i % 9 === 0;
      const hour = 9 + (i % 7);
      const domain = DOMAINS[i % 8];
      const row = await post("/api/calendar-events", {
        title: category === "ABSENCE" ? `${demoMembers[i % 12].name} 연차` : category === "HOLIDAY" ? "팀 공동 휴무일" : `${domain.name} ${["정기 운영 회의", "현업 검토", "이관 결과 확인", "테스트 일정 조율"][i % 4]}`,
        category, allDay,
        startDateTime: iso(day, allDay ? 0 : hour), endDateTime: iso(day + (allDay ? 1 : 0), allDay ? 0 : hour + 1 + (i % 2) * 0.5),
        memberIds: category === "HOLIDAY" ? [] : Array.from({ length: category === "ABSENCE" ? 1 : 1 + i % 3 }, (_, n) => demoMembers[(i + n) % 12].id),
        note: `${tag}\n${category === "ABSENCE" ? "부재 중 요청은 팀 담당자에게 전달해 주세요." : category === "HOLIDAY" ? "샘플 팀의 공동 휴무 일정입니다." : `${domain.department}와 진행 상황, 미결 항목, 다음 이관 일정을 확인합니다. 회의 전 관련 요청과 테스트 결과를 준비해 주세요.`}`,
      }, async () => (await get(eventRange)).items.find((item) => item.note?.includes(tag)), "CalendarEvent", "events");
      events.push(row);
    }

    console.log("생성 완료. API 전 페이지·관계·감사 로그·DB 무결성 검증 중.");
    const allWork = await pages("/api/work-items?scope=all");
    const seeded = allWork.items.filter((row) => row.requestNumber?.startsWith(`${PREFIX}-`));
    const apiCount = await get("/api/work-items/count");
    assert.equal(allWork.items.length, apiCount.total);
    assert.equal(apiCount.total, baselineWorkCount + added.workItems);
    assert.equal(seeded.length, 2000);
    assert.equal(new Set(seeded.map((row) => row.requestNumber)).size, 2000);
    assert.deepEqual(tally(seeded, "status"), STATUS_COUNTS);
    const active = await pages("/api/work-items?scope=active");
    const transferred = await pages("/api/work-items?scope=transferred");
    assert.equal(active.items.length + transferred.items.length, apiCount.total);
    assert.equal(transferred.items.filter((row) => row.requestNumber?.startsWith(`${PREFIX}-`)).length, 680);

    const after = {};
    for (const table of TABLES) {
      after[table] = await readSql(`SELECT * FROM "${table}"`);
      const unchangedRows = new Set(after[table].map((row) => JSON.stringify(row)));
      for (const row of before[table]) assert.ok(unchangedRows.has(JSON.stringify(row)), `기존 ${table} 데이터 변경 감지`);
    }
    const seededDb = after.WorkItem.filter((row) => row.requestNumber?.startsWith(`${PREFIX}-`));
    const seededIds = new Set(seededDb.map((row) => row.id));
    assert.equal(seededDb.length, 2000);
    const createAudits = after.AuditLog.filter((row) => row.entityType === "WorkItem" && row.action === "CREATE" && seededIds.has(row.entityId));
    assert.equal(new Set(createAudits.map((row) => row.entityId)).size, 2000);
    const memberIds = new Set(after.TeamMember.filter((row) => !row.deletedAt).map((row) => row.id));
    const categoryCodes = new Set(after.WorkCategory.filter((row) => !row.deletedAt).map((row) => row.code));
    const systemCodes = new Set(after.WorkSystem.filter((row) => !row.deletedAt).map((row) => row.code));
    for (const row of seededDb) {
      assert.ok(!row.assigneeId || memberIds.has(row.assigneeId));
      assert.ok(categoryCodes.has(row.category));
      assert.ok(!row.startDate || !row.endDate || row.startDate <= row.endDate);
      if (row.status === "TRANSFERRED") assert.ok(row.transferDate <= ANCHOR && row.endDate <= row.transferDate);
    }
    const tickets = after.WorkTicket.filter((row) => seededIds.has(row.workItemId) && !row.deletedAt);
    for (const row of tickets) assert.ok(systemCodes.has(row.systemName));
    const sqlTodo = after.Todo.filter((row) => row.note?.includes(`[${PREFIX.toLowerCase()}-todo-`));
    const sqlEvents = after.CalendarEvent.filter((row) => row.note?.includes(`[${PREFIX.toLowerCase()}-event-`));
    const apiTodos = (await pages("/api/todos?include=checklist")).items.filter((row) => row.note?.includes(`[${PREFIX.toLowerCase()}-todo-`));
    const apiEvents = (await get(eventRange)).items.filter((row) => row.note?.includes(`[${PREFIX.toLowerCase()}-event-`));
    assert.equal(sqlTodo.length, 60); assert.equal(apiTodos.length, 60);
    assert.equal(sqlEvents.length, 36); assert.equal(apiEvents.length, 36);
    for (const event of sqlEvents) assert.ok(event.startDateTime < event.endDateTime);
    const todoIds = new Set(sqlTodo.map((row) => row.id));
    const checklist = after.TodoChecklist.filter((row) => todoIds.has(row.todoId) && !row.deletedAt);
    assert.ok(checklist.length >= 180);
    for (const row of checklist) assert.ok(!row.assigneeId || memberIds.has(row.assigneeId));
    for (const todo of apiTodos) assert.ok(Array.isArray(todo.checklist) && todo.checklist.length >= 3);
    const integrity = await readSql("PRAGMA integrity_check");
    const foreignKeys = await readSql("PRAGMA foreign_key_check");
    assert.equal(integrity.length, 1); assert.equal(Object.values(integrity[0])[0], "ok");
    assert.equal(foreignKeys.length, 0);
    const details = [];
    for (const status of Object.keys(STATUS_COUNTS)) {
      const row = seeded.find((item) => item.status === status);
      const detail = await get(`/api/work-items/${row.id}`);
      assert.equal(detail.requestNumber, row.requestNumber);
      assert.ok(detail.description.length > 100);
      assert.ok(Array.isArray(detail.tickets));
      details.push({ id: detail.id, requestNumber: detail.requestNumber, status, title: detail.title, descriptionLength: detail.description.length, tickets: detail.tickets.length });
    }
    const durations = requestMs.toSorted((a, b) => a - b);
    const summary = {
      generatedAt: new Date().toISOString(), node: process.version, baseUrl, dbPath,
      seedPrefix: PREFIX, anchorKst: "2026-10-21", elapsedMs: Math.round(performance.now() - started),
      added, recoveredPosts, retries,
      baseline: Object.fromEntries(TABLES.map((table) => [table, before[table].length])),
      totals: Object.fromEntries(TABLES.map((table) => [table, after[table].length])),
      seeded: {
        workItems: seeded.length, status: tally(seeded, "status"), priority: tally(seeded, "priority"),
        unassigned: seededDb.filter((row) => !row.assigneeId).length,
        withoutTickets: seededDb.filter((row) => !tickets.some((ticket) => ticket.workItemId === row.id)).length,
        tickets: tickets.length, longDescriptions: seededDb.filter((row) => row.description?.length > 1000).length,
        workDateRange: { from: new Date(Math.min(...seededDb.map((row) => row.startDate).filter(Boolean))).toISOString(), to: new Date(Math.max(...seededDb.map((row) => row.endDate).filter(Boolean))).toISOString() },
        todos: sqlTodo.length, checklist: checklist.length, todoStatus: tally(sqlTodo, "status"),
        calendarEvents: sqlEvents.length, calendarCategory: tally(sqlEvents, "category"),
        createAudits: createAudits.length,
      },
      verification: { apiTotal: apiCount.total, allPages: allWork.pageCount, uniqueIds: new Set(allWork.items.map((row) => row.id)).size, active: active.items.length, transferred: transferred.items.length, existingRowsPreserved: true, integrity: "ok", foreignKeyViolations: foreignKeys.length, samples: details },
      apiRequests: { count: requestMs.length, medianMs: Number(durations[Math.floor(durations.length / 2)].toFixed(2)), p95Ms: Number(durations[Math.floor(durations.length * 0.95)].toFixed(2)) },
      dbBytes: fs.statSync(dbPath).size,
      note: "실제 API로 생성한 샘플입니다. createdAt/updatedAt은 실제 생성 시각이며 업무 날짜만 과거·현재·예정으로 분산했습니다. 실행 중 기존 데이터는 변경하거나 삭제하지 않습니다.",
    };
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify({ added, seeded: summary.seeded, verification: { ...summary.verification, samples: "8 status details checked" }, elapsedMs: summary.elapsedMs, summary: OUTPUT }, null, 2));
  } finally { sql.close(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
