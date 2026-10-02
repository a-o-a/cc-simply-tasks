import { NextResponse } from "next/server";
import { ZodError, flattenError } from "zod";
import { isAllowedWriteRequest } from "./request-security";
import { HttpError, HTTP_ERROR_STATUS, type ErrorCode } from "./errors";

export { HttpError } from "./errors";
export type { ErrorCode } from "./errors";

/**
 * 표준 에러 응답 포맷: { error: { code, message, details? } }
 *
 * code 규칙:
 *   VALIDATION_ERROR    - zod 검증 실패
 *   NOT_FOUND           - 리소스 없음
 *   CONFLICT            - unique 제약 위반
 *   BAD_REQUEST         - 기타 잘못된 요청
 *   INTERNAL            - 서버 내부 오류
 */

export function errorResponse(
  code: ErrorCode,
  message: string,
  details?: unknown,
): NextResponse {
  return NextResponse.json(
    { error: { code, message, ...(details !== undefined ? { details } : {}) } },
    { status: HTTP_ERROR_STATUS[code] },
  );
}

/**
 * API route handler wrapper.
 * ZodError / HttpError / 기타 에러를 표준 응답으로 변환.
 */
export function withErrorHandler<Args extends unknown[]>(
  handler: (...args: Args) => Promise<NextResponse>,
): (...args: Args) => Promise<NextResponse> {
  return async (...args: Args) => {
    try {
      const request = args[0] as Request | undefined;
      if (request && typeof request.method === "string" && !isAllowedWriteRequest(request)) {
        throw new HttpError("FORBIDDEN", "다른 사이트에서 보낸 변경 요청은 허용하지 않습니다");
      }
      return await handler(...args);
    } catch (err) {
      // Let Next.js switch a route to dynamic rendering instead of turning its signal into a 500.
      if (err && typeof err === "object" && "digest" in err && err.digest === "DYNAMIC_SERVER_USAGE") {
        throw err;
      }
      if (err instanceof ZodError) {
        return errorResponse("VALIDATION_ERROR", "입력값 검증 실패", flattenError(err));
      }
      if (err instanceof HttpError) {
        return errorResponse(err.code, err.message, err.details);
      }
      // SQLite unique 제약 위반 등
      if (err && typeof err === "object" && "code" in err) {
        const dbCode = (err as { code: unknown }).code;
        if (
          dbCode === "P2002" ||
          dbCode === "SQLITE_CONSTRAINT_UNIQUE" ||
          dbCode === "SQLITE_CONSTRAINT_PRIMARYKEY"
        ) {
          return errorResponse("CONFLICT", "중복된 값이 존재합니다");
        }
        if (dbCode === "P2025") {
          return errorResponse("NOT_FOUND", "대상 리소스를 찾을 수 없습니다");
        }
      }
      if (err instanceof Error && /UNIQUE constraint failed/i.test(err.message)) {
        return errorResponse("CONFLICT", "중복된 값이 존재합니다");
      }
      console.error("[api] unhandled error:", err);
      return errorResponse("INTERNAL", "서버 내부 오류");
    }
  };
}


const MAX_JSON_BODY_BYTES = 256 * 1024;

/** Limit actual streamed bytes as well as Content-Length; never trust the header alone. */
export async function readJsonBody(request: Request, maxBytes = MAX_JSON_BODY_BYTES): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|$)/i.test(contentType)) {
    throw new HttpError("BAD_REQUEST", "Content-Type은 application/json이어야 합니다");
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > maxBytes) throw new HttpError("PAYLOAD_TOO_LARGE", "요청 본문이 너무 큽니다");
  if (!request.body) throw new HttpError("BAD_REQUEST", "JSON 요청 본문이 필요합니다");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        // Next.js owns the incoming transport. Cancelling its cloned stream can
        // wait indefinitely or reset the socket before the 413 response is sent.
        throw new HttpError("PAYLOAD_TOO_LARGE", "요청 본문이 너무 큽니다");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
  } catch {
    throw new HttpError("BAD_REQUEST", "올바른 JSON 요청 본문이 필요합니다");
  }
}
