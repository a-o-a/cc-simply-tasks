import { NextResponse, type NextRequest } from "next/server";
import { asc, eq, isNull } from "drizzle-orm";
import { db, ensureSqlitePragma } from "@/lib/db";
import { newId, now } from "@/lib/db/helpers";
import { workSystems } from "@/lib/db/schema";
import { withErrorHandler } from "@/lib/http";
import { getActorContext } from "@/lib/actor";
import { withAudit } from "@/lib/audit";
import { workSystemCreateSchema } from "@/lib/validation/workSystem";

/**
 * GET /api/work-systems
 * 삭제되지 않은 작업 시스템 목록 (code 오름차순).
 */
export const GET = withErrorHandler(async () => {
  await ensureSqlitePragma();
  const items = await db
    .select()
    .from(workSystems)
    .where(isNull(workSystems.deletedAt))
    .orderBy(asc(workSystems.code));
  return NextResponse.json({ items });
});

/**
 * POST /api/work-systems
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  await ensureSqlitePragma();
  const actor = getActorContext(req);
  const input = workSystemCreateSchema.parse(await req.json());
  const timestamp = now();

  const created = db.transaction((tx) => {
    const existing = tx
      .select()
      .from(workSystems)
      .where(eq(workSystems.code, input.code))
      .limit(1)
      .get();
    const row = existing
      ? {
          ...existing,
          name: input.name,
          updatedAt: timestamp,
          deletedAt: null,
        }
      : {
          id: newId(),
          code: input.code,
          name: input.name,
          createdAt: timestamp,
          updatedAt: timestamp,
          deletedAt: null,
        };

    if (existing) {
      tx.update(workSystems).set(row).where(eq(workSystems.id, existing.id)).run();
    } else {
      tx.insert(workSystems).values(row).run();
    }

    withAudit(tx, {
      entityType: "WorkSystem",
      entityId: row.id,
      action: "CREATE",
      after: row as unknown as Record<string, unknown>,
      actor,
    });
    return row;
  });

  return NextResponse.json(created, { status: 201 });
});
