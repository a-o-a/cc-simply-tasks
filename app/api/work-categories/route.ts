import { NextResponse, type NextRequest } from "next/server";
import { prisma, ensureSqlitePragma } from "@/lib/db";
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
  const items = await prisma.workCategory.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ items });
});

/**
 * POST /api/work-categories
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  await ensureSqlitePragma();
  const actor = getActorContext(req);
  const input = workCategoryCreateSchema.parse(await req.json());

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.workCategory.create({ data: input });
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
