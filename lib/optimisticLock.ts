import { HttpError } from "./http";

/**
 * 낙관적 락 검사.
 *
 * 클라이언트는 PATCH/DELETE 시 `If-Match` 헤더에 직전 GET으로 받은 updatedAt의
 * ISO 문자열을 그대로 싣는다. 서버는 현재 엔티티의 updatedAt과 비교해 불일치 시 409.
 *
 * 사용 예:
 *   const current = await tx.workItem.findUnique({ where: { id } });
 *   if (!current) throw new HttpError("NOT_FOUND", "...");
 *   assertIfMatch(req, current.updatedAt);
 */
export function assertIfMatch(
  req: Request,
  currentUpdatedAt: Date,
): void {
  const header = req.headers.get("if-match");
  if (!header) {
    // If-Match 생략은 허용하지 않음. 안전한 write를 강제.
    throw new HttpError(
      "BAD_REQUEST",
      "If-Match 헤더가 필요합니다 (직전 updatedAt ISO)",
    );
  }
  const normalized = header.trim().replace(/^"|"$/g, "");
  const currentIso = currentUpdatedAt.toISOString();
  if (normalized !== currentIso) {
    throw new HttpError(
      "CONFLICT",
      "다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도해주세요.",
      { serverUpdatedAt: currentIso },
    );
  }
}
