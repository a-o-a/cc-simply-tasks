import { NextResponse, type NextRequest } from "next/server";
import { asc, eq, isNull } from "drizzle-orm";
import { db, ensureSqlitePragma } from "@/lib/db";
import { newId, now } from "@/lib/db/helpers";
import { workCategories } from "@/lib/db/schema";
import { withErrorHandler } from "@/lib/http";
import { getActorContext } from "@/lib/actor";
import { withAudit } from "@/lib/audit";
import { workCategoryCreateSchema } from "@/lib/validation/workCategory";

/**
 * GET /api/work-categories
 * 삭제되지 않은 작업 분류 목록 (name 오름차순).
 */
export const GET = withErrorHandler(async () => {
  await ensureSqlitePragma();
  const items = await db
    .select()
    .from(workCategories)
    .where(isNull(workCategories.deletedAt))
    .orderBy(asc(workCategories.name));
  return NextResponse.json({ items });
});

/**
 * POST /api/work-categories
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  await ensureSqlitePragma();
  const actor = getActorContext(req);
  const input = workCategoryCreateSchema.parse(await req.json());
  const timestamp = now();

  const created = await db.transaction(async (tx) => {
    const existingRows = await tx
      .select()
      .from(workCategories)
      .where(eq(workCategories.code, input.code))
      .limit(1);
    const existing = existingRows[0];
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
      await tx.update(workCategories).set(row).where(eq(workCategories.id, existing.id));
    } else {
      await tx.insert(workCategories).values(row);
    }

    await withAudit(tx, {
      entityType: "WorkCategory",
      entityId: row.id,
      action: "CREATE",
      after: row as unknown as Record<string, unknown>,
      actor,
    });
    return row;
  });

  return NextResponse.json(created, { status: 201 });
});
