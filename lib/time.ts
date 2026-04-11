/**
 * 타임존 유틸.
 *
 * 원칙:
 *  - DB 저장은 항상 UTC (Date 객체 = epoch ms)
 *  - UI 표시는 Asia/Seoul (KST, UTC+9)
 *  - all-day 이벤트는 [start, end) 반열림 구간, start/end는 KST 자정의 UTC 표현
 *
 * Intl.DateTimeFormat 기반이라 추가 라이브러리 없음 (Node 16 OK).
 */

export const APP_TIMEZONE = "Asia/Seoul";
const KST_OFFSET_MINUTES = 9 * 60; // UTC+9, DST 없음

/**
 * "YYYY-MM-DD" (KST 기준 날짜 문자열) → 해당 KST 자정의 UTC Date.
 * all-day 이벤트의 start/end를 정규화할 때 사용.
 */
export function kstDateStringToUtc(dateStr: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) {
    throw new Error(`invalid date string: ${dateStr} (expected YYYY-MM-DD)`);
  }
  const [, y, m, d] = match;
  // KST 자정 = UTC 전날 15:00
  const utcMs = Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0) -
    KST_OFFSET_MINUTES * 60 * 1000;
  return new Date(utcMs);
}

/**
 * UTC Date → KST "YYYY-MM-DD".
 */
export function utcToKstDateString(date: Date): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

/**
 * all-day 이벤트 입력을 정규화.
 *   입력: { start: "2026-04-11", end: "2026-04-12" } (KST 날짜, 반열림)
 *   출력: { startDateTime: Date(UTC), endDateTime: Date(UTC), allDay: true }
 *
 * endDate가 포함(closed) 의미로 들어온 경우 +1일 처리는 호출자 책임.
 */
export function normalizeAllDayRange(startDateStr: string, endDateStr: string): {
  startDateTime: Date;
  endDateTime: Date;
} {
  const startDateTime = kstDateStringToUtc(startDateStr);
  const endDateTime = kstDateStringToUtc(endDateStr);
  if (endDateTime.getTime() <= startDateTime.getTime()) {
    throw new Error("endDate must be after startDate (half-open [start, end))");
  }
  return { startDateTime, endDateTime };
}

/**
 * KST 기준 오늘 자정의 UTC Date.
 */
export function kstTodayUtc(): Date {
  const today = utcToKstDateString(new Date());
  return kstDateStringToUtc(today);
}
