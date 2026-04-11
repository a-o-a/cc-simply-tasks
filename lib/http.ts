import { NextResponse } from "next/server";
import { ZodError } from "zod";

/**
 * 표준 에러 응답 포맷: { error: { code, message, details? } }
 *
 * code 규칙:
 *   VALIDATION_ERROR    - zod 검증 실패
 *   NOT_FOUND           - 리소스 없음
 *   CONFLICT            - 낙관적 락 충돌 / unique 제약 위반
 *   BAD_REQUEST         - 기타 잘못된 요청
 *   INTERNAL            - 서버 내부 오류
 */

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "BAD_REQUEST"
  | "INTERNAL";

const STATUS_MAP: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL: 500,
};

export class HttpError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function errorResponse(
  code: ErrorCode,
  message: string,
  details?: unknown,
): NextResponse {
  return NextResponse.json(
    { error: { code, message, ...(details !== undefined ? { details } : {}) } },
    { status: STATUS_MAP[code] },
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
      return await handler(...args);
    } catch (err) {
      if (err instanceof ZodError) {
        return errorResponse("VALIDATION_ERROR", "입력값 검증 실패", err.flatten());
      }
      if (err instanceof HttpError) {
        return errorResponse(err.code, err.message, err.details);
      }
      // Prisma unique 제약 위반 등
      if (err && typeof err === "object" && "code" in err) {
        const prismaCode = (err as { code: unknown }).code;
        if (prismaCode === "P2002") {
          return errorResponse("CONFLICT", "중복된 값이 존재합니다");
        }
        if (prismaCode === "P2025") {
          return errorResponse("NOT_FOUND", "대상 리소스를 찾을 수 없습니다");
        }
      }
      // eslint-disable-next-line no-console
      console.error("[api] unhandled error:", err);
      return errorResponse("INTERNAL", "서버 내부 오류");
    }
  };
}
