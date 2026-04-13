import { NextResponse, type NextRequest } from "next/server";
import { prisma, ensureSqlitePragma } from "@/lib/db";
import { withErrorHandler, HttpError } from "@/lib/http";
import { getActorContext } from "@/lib/actor";
import { withAudit } from "@/lib/audit";
import { assertIfMatch } from "@/lib/optimisticLock";
import { workCategoryUpdateSchema } from "@/lib/validation/workCategory";

type Params = { params: { id: string } };

export const PATCH = withErrorHandler(async (req: NextRequest, { params }: Params) => {
  await ensureSqlitePragma();
  const actor = getActorContext(req);
  const input = workCategoryUpdateSchema.parse(await req.json());

  const updated = await prisma.$transaction(async (tx) => {
    const before = await tx.workCategory.findFirst({
      where: { id: params.id, deletedAt: null },
    });
    if (!before) throw new HttpError("NOT_FOUND", "작업 분류를 찾을 수 없습니다");
    assertIfMatch(req, before.updatedAt);

    const after = await tx.workCategory.update({ where: { id: params.id }, data: input });
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

  await prisma.$transaction(async (tx) => {
    const before = await tx.workCategory.findFirst({
      where: { id: params.id, deletedAt: null },
    });
    if (!before) throw new HttpError("NOT_FOUND", "작업 분류를 찾을 수 없습니다");
    assertIfMatch(req, before.updatedAt);

    const after = await tx.workCategory.update({
      where: { id: params.id },
      data: { deletedAt: new Date() },
    });
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
