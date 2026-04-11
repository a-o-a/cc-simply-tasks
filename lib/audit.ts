import type { Prisma } from "@prisma/client";
import type { ActorContext } from "./actor";
import type { AuditAction, AuditEntityType } from "./enums";
import { computeDiff, diffToJsonStrings } from "./diff";

/**
 * 감사 로그 쓰기 헬퍼.
 *
 * 핵심 원칙:
 *   - 반드시 Prisma.TransactionClient 안에서만 호출 (= prisma.$transaction 내부).
 *     타입 파라미터가 TransactionClient라 일반 PrismaClient로 호출 불가 → 우회 차단.
 *   - 본 엔티티 write와 같은 트랜잭션에 묶여 "엔티티는 바뀌었는데 로그가 없음" 방지.
 *
 * 사용 예:
 *   await prisma.$transaction(async (tx) => {
 *     const before = await tx.workItem.findUnique({ where: { id } });
 *     const after = await tx.workItem.update({ where: { id }, data });
 *     await withAudit(tx, {
 *       entityType: "WorkItem",
 *       entityId: id,
 *       action: "UPDATE",
 *       before, after, actor,
 *     });
 *   });
 */
export async function withAudit(
  tx: Prisma.TransactionClient,
  params: {
    entityType: AuditEntityType;
    entityId: string;
    action: AuditAction;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    actor: ActorContext;
  },
): Promise<void> {
  const { entityType, entityId, action, before, after, actor } = params;

  const diff = computeDiff(before ?? null, after ?? null);
  const { beforeJson, afterJson } = diffToJsonStrings(diff);

  // CREATE/DELETE/RESTORE는 diff가 비어 있어도 기록. UPDATE는 변경 없음이면 스킵.
  if (action === "UPDATE" && beforeJson === null && afterJson === null) {
    return;
  }

  await tx.auditLog.create({
    data: {
      entityType,
      entityId,
      action,
      beforeJson,
      afterJson,
      actorType: actor.actorType,
      actorName: actor.actorName,
      actorIp: actor.actorIp,
      userAgent: actor.userAgent,
    },
  });
}
