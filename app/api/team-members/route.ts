import { NextResponse, type NextRequest } from "next/server";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db, ensureSqlitePragma } from "@/lib/db";
import { newId, now } from "@/lib/db/helpers";
import { teamMembers } from "@/lib/db/schema";
import { withErrorHandler } from "@/lib/http";
import { getActorContext } from "@/lib/actor";
import { withAudit } from "@/lib/audit";
import { parsePagination, slicePageAfterCursor } from "@/lib/pagination";
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
  const rows = await db
    .select()
    .from(teamMembers)
    .where(
      and(
        isNull(teamMembers.deletedAt),
        filters.role ? eq(teamMembers.role, filters.role) : undefined,
      ),
    )
    .orderBy(asc(teamMembers.name), asc(teamMembers.id));

  const { items, nextCursor } = slicePageAfterCursor(rows, cursor, take);
  return NextResponse.json({ items, nextCursor });
});

/**
 * POST /api/team-members
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  await ensureSqlitePragma();
  const actor = getActorContext(req);
  const input = teamMemberCreateSchema.parse(await req.json());
  const createdAt = now();

  const created = db.transaction((tx) => {
    const row = {
      id: newId(),
      name: input.name,
      role: input.role,
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
    } satisfies typeof teamMembers.$inferInsert;

    tx.insert(teamMembers).values(row).run();
    withAudit(tx, {
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
