import { NextResponse, type NextRequest } from "next/server";
import { prisma, ensureSqlitePragma } from "@/lib/db";
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
  const items = await prisma.workSystem.findMany({
    where: { deletedAt: null },
    orderBy: { code: "asc" },
  });
  return NextResponse.json({ items });
});

/**
 * POST /api/work-systems
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  await ensureSqlitePragma();
  const actor = getActorContext(req);
  const input = workSystemCreateSchema.parse(await req.json());

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.workSystem.create({ data: input });
    await withAudit(tx, {
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
