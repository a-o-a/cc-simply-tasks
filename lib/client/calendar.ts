/**
 * 캘린더 페이지에서 쓰는 KST 기준 일/월 계산.
 *
 * 모든 함수는 KST(`Asia/Seoul`)를 기준으로 동작한다.
 * - DB 저장은 UTC, UI 그리드는 KST 자정을 day key로 사용
 * - all-day 이벤트는 [start, end) 반열림이라 end의 KST 날짜는 포함하지 않는다
 */

const KST_OFFSET_MINUTES = 9 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;

/** "2026-04-12" 같은 KST 날짜 문자열을 그 날 KST 자정의 UTC ms로. */
export function kstDateStringToUtcMs(dateStr: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) throw new Error(`invalid date: ${dateStr}`);
  return (
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) -
    KST_OFFSET_MINUTES * 60 * 1000
  );
}

/** UTC ms → "yyyy-MM-dd" KST 날짜 문자열. */
export function utcMsToKstDateString(ms: number): string {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

/** KST 기준 해당 월의 1일 0시 → UTC ms. */
export function kstMonthStart(year: number, month0: number): number {
  return kstDateStringToUtcMs(
    `${year}-${String(month0 + 1).padStart(2, "0")}-01`,
  );
}

/** 다음 달의 1일 0시 → UTC ms. */
export function kstMonthEnd(year: number, month0: number): number {
  const next = month0 === 11 ? { y: year + 1, m: 0 } : { y: year, m: month0 + 1 };
  return kstMonthStart(next.y, next.m);
}

/**
 * KST 월 그리드 — 일요일 시작 6주(42칸).
 * 첫 칸이 그 달 1일을 포함하는 주의 일요일.
 * 각 칸은 KST 자정의 UTC ms.
 */
export function kstMonthGrid(year: number, month0: number): number[] {
  const firstMs = kstMonthStart(year, month0);
  // 1일의 KST 요일 — KST 자정의 UTC Date에서 KST의 요일을 다시 계산
  const dayOfWeek = new Date(firstMs + KST_OFFSET_MINUTES * 60 * 1000).getUTCDay();
  const startMs = firstMs - dayOfWeek * DAY_MS;
  return Array.from({ length: 42 }, (_, i) => startMs + i * DAY_MS);
}

/**
 * 한 캘린더 이벤트가 KST 기준 어떤 day key들에 걸쳐 있는지.
 * - allDay: [startKstDate, endKstDate) — 종료일은 제외
 * - non-allDay: 시작/끝의 KST 날짜를 모두 포함 (단순화)
 */
export function eventDayKeys(event: {
  startDateTime: string;
  endDateTime: string;
  allDay: boolean;
}): string[] {
  const start = new Date(event.startDateTime).getTime();
  const end = new Date(event.endDateTime).getTime();

  const startDay = kstDateStringToUtcMs(utcMsToKstDateString(start));
  // allDay end는 반열림이라 end-1ms의 날짜를 사용해 마지막 포함 day를 구한다
  // (예: end = 2026-04-12 KST 00:00 → end-1ms = 2026-04-11 KST 23:59:59 → 4/11)
  const endRefMs = event.allDay ? end - 1 : end;
  const endDay = kstDateStringToUtcMs(utcMsToKstDateString(endRefMs));

  const out: string[] = [];
  for (let ms = startDay; ms <= endDay; ms += DAY_MS) {
    out.push(utcMsToKstDateString(ms));
  }
  return out;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
export function weekdayLabel(idx: number): string {
  return WEEKDAYS[idx];
}

/** dateStr을 포함하는 일요일~토요일 7일 KST 날짜 배열. */
export function kstWeekContaining(dateStr: string): string[] {
  const ms = kstDateStringToUtcMs(dateStr);
  const dow = new Date(ms + KST_OFFSET_MINUTES * 60 * 1000).getUTCDay(); // 0=Sun
  const sundayMs = ms - dow * DAY_MS;
  return Array.from({ length: 7 }, (_, i) => utcMsToKstDateString(sundayMs + i * DAY_MS));
}

