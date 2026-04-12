import { NextResponse, type NextRequest } from "next/server";
import { prisma, ensureSqlitePragma } from "@/lib/db";
import { withErrorHandler } from "@/lib/http";
import { getActorContext } from "@/lib/actor";
import { withAudit } from "@/lib/audit";
import { parsePagination, toPage } from "@/lib/pagination";
import {
  teamMemberCreateSchema,
  teamMemberListQuerySchema,
} from "@/lib/validation/teamMember";

/**
 * GET /api/team-members
 *   ?role, ?cursor, ?pageSize
 *
 * soft delete 제외. name asc + id 로 안정 정렬.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  await ensureSqlitePragma();
  const { searchParams } = new URL(req.url);
  const filters = teamMemberListQuerySchema.parse(
    Object.fromEntries(searchParams),
  );
  const { take, cursor } = parsePagination(searchParams);

  const rows = await prisma.teamMember.findMany({
    where: {
      deletedAt: null,
      ...(filters.role ? { role: filters.role } : {}),
    },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });

  const { items, nextCursor } = toPage(rows, take);
  return NextResponse.json({ items, nextCursor });
});

/**
 * POST /api/team-members
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  await ensureSqlitePragma();
  const actor = getActorContext(req);
  const input = teamMemberCreateSchema.parse(await req.json());

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.teamMember.create({
      data: {
        name: input.name,
        role: input.role,
      },
    });
    await withAudit(tx, {
      entityType: "TeamMember",
      entityId: row.id,
      action: "CREATE",
      after: row as unknown as Record<string, unknown>,
      actor,
    });
    return row;
  });

  return NextResponse.json(created, { status: 201 });
});
