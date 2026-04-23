/**
 * 클라이언트용 fetch wrapper.
 *
 * 책임:
 *  1. `x-actor-name` 헤더를 localStorage에서 자동 주입
 *  2. 표준 에러 응답 `{ error: { code, message, details? } }` 파싱 → `ApiError` throw
 *  4. JSON 직렬화/역직렬화
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
  | "INTERNAL"
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

interface RequestOptions {
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
      // 비-JSON 응답은 그대로 메시지로 취급
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

export const api = {
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
