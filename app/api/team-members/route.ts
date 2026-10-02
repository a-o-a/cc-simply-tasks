import { NextResponse, type NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db, ensureSqlitePragma } from "@/lib/db";
import { newId, now } from "@/lib/db/helpers";
import { teamMembers, type TeamMemberRow } from "@/lib/db/schema";
import { withErrorHandler, readJsonBody } from "@/lib/http";
import { getActorContext } from "@/lib/actor";
import { withAudit } from "@/lib/audit";
import { parsePagination, createCursorPagination } from "@/lib/pagination";
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
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const GET = withErrorHandler(async (req: NextRequest) => {
  await ensureSqlitePragma();
  const { searchParams } = new URL(req.url);
  const filters = teamMemberListQuerySchema.parse(
    Object.fromEntries(searchParams),
  );
  const { take, cursor } = parsePagination(searchParams);
  const pagination = createCursorPagination<TeamMemberRow>("team-members", [
    { column: teamMembers.name, value: (row) => row.name, direction: "asc" },
    { column: teamMembers.id, value: (row) => row.id, direction: "asc" },
  ]);
  const conditions = [isNull(teamMembers.deletedAt), filters.role ? eq(teamMembers.role, filters.role) : undefined];
  const afterCursor = await pagination.condition(cursor, async (id) => {
    const [row] = await db.select().from(teamMembers).where(and(...conditions, eq(teamMembers.id, id))).limit(1);
    return row;
  });
  const rows = await db
    .select()
    .from(teamMembers)
    .where(and(...conditions, afterCursor))
    .orderBy(...pagination.orderBy)
    .limit(take + 1);

  const { items, nextCursor } = pagination.page(rows, take);
  return NextResponse.json({ items, nextCursor });
});

/**
 * POST /api/team-members
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  await ensureSqlitePragma();
  const actor = getActorContext(req);
  const input = teamMemberCreateSchema.parse(await readJsonBody(req));
  const createdAt = now();

  const created = await db.transaction(async (tx) => {
    const row = {
      id: newId(),
      name: input.name,
      role: input.role,
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
    } satisfies typeof teamMembers.$inferInsert;

    await tx.insert(teamMembers).values(row);
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
