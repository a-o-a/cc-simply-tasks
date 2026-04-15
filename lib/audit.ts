import type { ActorContext } from "./actor";
import type { AuditAction, AuditEntityType } from "./enums";
import { computeDiff, diffToJsonStrings } from "./diff";
import { auditLogs } from "./db/schema";
import { createId } from "@paralleldrive/cuid2";

/**
 * 감사 로그 쓰기 헬퍼.
 *
 * 핵심 원칙:
 *   - 반드시 DB transaction 안에서만 호출.
 *   - 본 엔티티 write와 같은 트랜잭션에 묶여 "엔티티는 바뀌었는데 로그가 없음" 방지.
 *
 * 사용 예:
 *   db.transaction((tx) => {
 *     const before = tx.select().from(workItems).where(eq(workItems.id, id)).get();
 *     const after = { ...before, title: "changed" };
 *     tx.update(workItems).set(after).where(eq(workItems.id, id)).run();
 *     withAudit(tx, {
 *       entityType: "WorkItem",
 *       entityId: id,
 *       action: "UPDATE",
 *       before, after, actor,
 *     });
 *   });
 */
type AuditInsertClient = {
  insert: (
    table: typeof auditLogs,
  ) => {
    values: (value: typeof auditLogs.$inferInsert) => {
      run: () => unknown;
    };
  };
};

export function withAudit(
  tx: AuditInsertClient,
  params: {
    entityType: AuditEntityType;
    entityId: string;
    action: AuditAction;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    actor: ActorContext;
  },
): void {
  const { entityType, entityId, action, before, after, actor } = params;

  const diff = computeDiff(before ?? null, after ?? null);
  const { beforeJson, afterJson } = diffToJsonStrings(diff);

  // CREATE/DELETE/RESTORE는 diff가 비어 있어도 기록. UPDATE는 변경 없음이면 스킵.
  if (action === "UPDATE" && beforeJson === null && afterJson === null) {
    return;
  }

  tx.insert(auditLogs).values({
    id: createId(),
    entityType,
    entityId,
    action,
    beforeJson,
    afterJson,
    actorType: actor.actorType,
    actorName: actor.actorName,
    actorIp: actor.actorIp,
    userAgent: actor.userAgent,
  }).run();
}
