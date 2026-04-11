/**
 * before/after 객체에서 변경된 필드만 추출.
 * 감사 로그의 beforeJson/afterJson에 풀 스냅샷 대신 diff만 저장해 용량을 절약한다.
 *
 * - 값 비교는 shallow. Date는 getTime() 기준. 나머지는 JSON.stringify 기준.
 * - 배열/객체 중첩 diff는 1차 범위 밖. 필요 시 라이브러리 도입.
 */

type Json = unknown;

function normalize(v: unknown): Json {
  if (v instanceof Date) return v.toISOString();
  return v;
}

function eq(a: unknown, b: unknown): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return true;
  try {
    return JSON.stringify(na) === JSON.stringify(nb);
  } catch {
    return false;
  }
}

export function computeDiff<T extends Record<string, unknown>>(
  before: T | null | undefined,
  after: T | null | undefined,
): { before: Partial<T>; after: Partial<T> } {
  const b: Partial<T> = {};
  const a: Partial<T> = {};

  // CREATE: before 없음 → after 전체
  if (!before && after) {
    return { before: {}, after: { ...after } };
  }
  // DELETE: after 없음 → before 전체
  if (before && !after) {
    return { before: { ...before }, after: {} };
  }
  if (!before || !after) {
    return { before: b, after: a };
  }

  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    const bv = (before as Record<string, unknown>)[k];
    const av = (after as Record<string, unknown>)[k];
    if (!eq(bv, av)) {
      (b as Record<string, unknown>)[k] = bv;
      (a as Record<string, unknown>)[k] = av;
    }
  }
  return { before: b, after: a };
}

export function diffToJsonStrings(
  diff: { before: Partial<Record<string, unknown>>; after: Partial<Record<string, unknown>> },
): { beforeJson: string | null; afterJson: string | null } {
  const beforeEmpty = Object.keys(diff.before).length === 0;
  const afterEmpty = Object.keys(diff.after).length === 0;
  return {
    beforeJson: beforeEmpty ? null : JSON.stringify(diff.before, jsonReplacer),
    afterJson: afterEmpty ? null : JSON.stringify(diff.after, jsonReplacer),
  };
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  return value;
}
