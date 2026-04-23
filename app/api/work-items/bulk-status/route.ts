import { NextResponse, type NextRequest } from "next/server";
import { and, inArray, isNull, ne } from "drizzle-orm";
import { db, ensureSqlitePragma } from "@/lib/db";
import { now } from "@/lib/db/helpers";
import { workItems } from "@/lib/db/schema";
import { withAudit } from "@/lib/audit";
import { getActorContext } from "@/lib/actor";
import { HttpError, withErrorHandler } from "@/lib/http";
import { workItemBulkStatusUpdateSchema } from "@/lib/validation/workItem";

type BulkStatusResponse = {
  updatedCount: number;
  updatedIds: string[];
  skippedIds: string[];
};

export const POST = withErrorHandler(async (req: NextRequest) => {
  await ensureSqlitePragma();
  const actor = getActorContext(req);
  const input = workItemBulkStatusUpdateSchema.parse(await req.json());
  const ids = Array.from(new Set(input.ids));
  const updatedAt = now();

  const result = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(workItems)
      .where(and(isNull(workItems.deletedAt), inArray(workItems.id, ids)));

    const byId = new Map(rows.map((row) => [row.id, row]));
    const missingIds = ids.filter((id) => !byId.has(id));
    if (missingIds.length > 0) {
      throw new HttpError("NOT_FOUND", "일부 작업을 찾을 수 없습니다", { missingIds });
    }

    const candidates = rows.filter((row) => row.status !== input.status);
    if (candidates.length === 0) {
      return {
        updatedCount: 0,
        updatedIds: [],
        skippedIds: ids,
      } satisfies BulkStatusResponse;
    }

    await tx
      .update(workItems)
      .set({ status: input.status, updatedAt })
      .where(
        and(
          isNull(workItems.deletedAt),
          inArray(
            workItems.id,
            candidates.map((row) => row.id),
          ),
          ne(workItems.status, input.status),
        ),
      );

    for (const before of candidates) {
      const after = { ...before, status: input.status, updatedAt };
      await withAudit(tx, {
        entityType: "WorkItem",
        entityId: before.id,
        action: "UPDATE",
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
        actor,
      });
    }

    return {
      updatedCount: candidates.length,
      updatedIds: candidates.map((row) => row.id),
      skippedIds: ids.filter((id) => !candidates.some((row) => row.id === id)),
    } satisfies BulkStatusResponse;
  });

  return NextResponse.json(result);
});
