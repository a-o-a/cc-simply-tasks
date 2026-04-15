import { NextResponse, type NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db, ensureSqlitePragma } from "@/lib/db";
import { now } from "@/lib/db/helpers";
import { workCategories } from "@/lib/db/schema";
import { withErrorHandler, HttpError } from "@/lib/http";
import { getActorContext } from "@/lib/actor";
import { withAudit } from "@/lib/audit";
import { workCategoryUpdateSchema } from "@/lib/validation/workCategory";

type Params = { params: { id: string } };

export const PATCH = withErrorHandler(async (req: NextRequest, { params }: Params) => {
  await ensureSqlitePragma();
  const actor = getActorContext(req);
  const input = workCategoryUpdateSchema.parse(await req.json());
  const updatedAt = now();

  const updated = await db.transaction(async (tx) => {
    const beforeRows = await tx
      .select()
      .from(workCategories)
      .where(and(eq(workCategories.id, params.id), isNull(workCategories.deletedAt)))
      .limit(1);
    const before = beforeRows[0];
    if (!before) throw new HttpError("NOT_FOUND", "작업 분류를 찾을 수 없습니다");

    const after = { ...before, ...input, updatedAt };
    await tx.update(workCategories).set(after).where(eq(workCategories.id, params.id));
    await withAudit(tx, {
      entityType: "WorkCategory",
      entityId: after.id,
      action: "UPDATE",
      before: before as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
      actor,
    });
    return after;
  });

  return NextResponse.json(updated);
});

export const DELETE = withErrorHandler(async (req: NextRequest, { params }: Params) => {
  await ensureSqlitePragma();
  const actor = getActorContext(req);
  const deletedAt = now();

  await db.transaction(async (tx) => {
    const beforeRows = await tx
      .select()
      .from(workCategories)
      .where(and(eq(workCategories.id, params.id), isNull(workCategories.deletedAt)))
      .limit(1);
    const before = beforeRows[0];
    if (!before) throw new HttpError("NOT_FOUND", "작업 분류를 찾을 수 없습니다");

    const after = { ...before, updatedAt: deletedAt, deletedAt };
    await tx.update(workCategories).set(after).where(eq(workCategories.id, params.id));
    await withAudit(tx, {
      entityType: "WorkCategory",
      entityId: after.id,
      action: "DELETE",
      before: before as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
      actor,
    });
  });

  return new NextResponse(null, { status: 204 });
});
