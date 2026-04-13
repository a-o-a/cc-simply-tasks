/**
 * 클라이언트 표시 전용 포맷터.
 * - 모든 시간 표시는 KST (`Asia/Seoul`)로 일관
 * - DB는 UTC, UI는 KST 원칙 (`lib/time.ts`와 짝)
 */

const KST = "Asia/Seoul";

export function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  // en-CA → yyyy-mm-dd
  return d.toLocaleDateString("en-CA", { timeZone: KST });
}

export function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const date = d.toLocaleDateString("en-CA", { timeZone: KST }); // yyyy-mm-dd
  const time = d.toLocaleTimeString("en-GB", {  // hh:mm:ss (24h)
    timeZone: KST,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return `${date} ${time}`;
}

/**
 * `<input type="date">`에 넣을 수 있는 KST 기준 yyyy-MM-dd 문자열.
 */
export function toDateInputValue(
  iso: string | Date | null | undefined,
): string {
  if (!iso) return "";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  // KST 기준 연/월/일 추출 (toLocaleDateString는 ko-KR이라 yyyy. mm. dd. 포맷 → 파싱 위험)
  // → en-CA를 쓰면 yyyy-mm-dd 그대로 나옴.
  return d.toLocaleDateString("en-CA", { timeZone: KST });
}

/**
 * `<input type="date">` 값(yyyy-MM-dd)을 UTC ISO로 변환.
 * KST 자정 → UTC ISO. 빈 문자열은 null.
 */
export function fromDateInputValue(value: string): string | null {
  if (!value) return null;
  // KST 자정 = UTC 전날 15:00. 하지만 작업 일자는 "그 날"의 의미라
  // 보존하려면 "yyyy-mm-ddT00:00:00+09:00"로 직접 만든다.
  return new Date(`${value}T00:00:00+09:00`).toISOString();
}
