/**
 * 클라이언트용 fetch wrapper.
 *
 * 책임:
 *  1. `x-actor-name` 헤더를 localStorage에서 자동 주입
 *  2. 표준 에러 응답 `{ error: { code, message, details? } }` 파싱 → `ApiError` throw
 *  3. JSON 직렬화/역직렬화와 취소 가능한 커서 목록 조회
 *
 * 서버 사이드(SSR/RSC)에서 호출하면 안 됨 — `localStorage` 접근이 필요하기 때문.
 */

export const ACTOR_NAME_STORAGE_KEY = "cc-simply-tasks:actor-name";
export const SERVICE_NAME_STORAGE_KEY = "cc-simply-tasks:service-name";
export const DEFAULT_SERVICE_NAME = "cc-simply-tasks";
export const TODOS_CHANGED_EVENT = "todos-changed";
export const WORK_ITEMS_CHANGED_EVENT = "work-items-changed";

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "BAD_REQUEST"
  | "FORBIDDEN"
  | "PAYLOAD_TOO_LARGE"
  | "INTERNAL"
  | "BAD_RESPONSE"
  | "NETWORK_ERROR";

export class ApiError extends Error {
  constructor(
    public code: ApiErrorCode,
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface RequestOptions {
  /** 본문(객체). JSON.stringify 후 전송. */
  body?: unknown;
  /** 추가 헤더. */
  headers?: Record<string, string>;
  /** 쿼리 파라미터. undefined 값은 자동 제외. */
  query?: Record<string, string | number | boolean | undefined | null>;
  /** 호출자 명시 시그널. */
  signal?: AbortSignal;
}

function readActorName(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACTOR_NAME_STORAGE_KEY);
}

function buildUrl(
  path: string,
  query?: RequestOptions["query"],
): string {
  if (!query) return path;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

async function request<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  if (options.signal?.aborted) throw createAbortError();
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(options.headers ?? {}),
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const actorName = readActorName();
  if (actorName) headers["x-actor-name"] = encodeURIComponent(actorName);

  let res: Response;
  try {
    res = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
      cache: "no-store",
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new ApiError(
      "NETWORK_ERROR",
      err instanceof Error ? err.message : "네트워크 오류",
      0,
    );
  }

  // 204 No Content
  if (res.status === 204) {
    return undefined as T;
  }

  let payload: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      if (res.ok) {
        throw new ApiError("BAD_RESPONSE", "서버 응답을 읽을 수 없습니다. 다시 시도해주세요.", res.status);
      }
    }
  }

  if (!res.ok) {
    const errObj =
      payload && typeof payload === "object" && "error" in payload
        ? (payload as { error: { code: ApiErrorCode; message: string; details?: unknown } }).error
        : null;
    throw new ApiError(
      errObj?.code ?? "INTERNAL",
      errObj?.message ?? `요청 실패 (${res.status})`,
      res.status,
      errObj?.details,
    );
  }

  return payload as T;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function createAbortError(): Error {
  const error = new Error("요청이 취소되었습니다.");
  error.name = "AbortError";
  return error;
}

/** 집계·보드처럼 전체 결과가 필요한 화면에서 커서를 끝까지 순회합니다. */
async function getAllPages<T>(
  path: string,
  options: Omit<RequestOptions, "body"> = {},
): Promise<T[]> {
  const items: T[] = [];
  const seenCursors = new Set<string>();
  let cursor = options.query?.cursor;
  if (typeof cursor === "string") seenCursors.add(cursor);

  do {
    const page = await request<{ items: T[]; nextCursor?: string | null }>("GET", path, {
      ...options,
      query: { pageSize: 100, ...options.query, cursor },
    });
    if (options.signal?.aborted) throw createAbortError();
    if (!page || !Array.isArray(page.items)) {
      throw new ApiError("BAD_RESPONSE", "목록 응답 형식이 올바르지 않습니다.", 200);
    }
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
    if (cursor != null) {
      if (typeof cursor !== "string" || !cursor || seenCursors.has(cursor)) {
        throw new ApiError("BAD_RESPONSE", "다음 목록을 불러오지 못했습니다. 다시 시도해주세요.", 200);
      }
      seenCursors.add(cursor);
    }
  } while (cursor != null);

  return items;
}

export const api = {
  getAllPages,
  get: <T>(path: string, options?: Omit<RequestOptions, "body">) =>
    request<T>("GET", path, options),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "body">) =>
    request<T>("POST", path, { ...options, body }),
  patch: <T>(
    path: string,
    body: unknown,
    options?: Omit<RequestOptions, "body">,
  ) => request<T>("PATCH", path, { ...options, body }),
  delete: <T>(
    path: string,
    options?: Omit<RequestOptions, "body">,
  ) => request<T>("DELETE", path, options),
};

export function emitTodosChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TODOS_CHANGED_EVENT));
}

export function emitWorkItemsChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WORK_ITEMS_CHANGED_EVENT));
}
