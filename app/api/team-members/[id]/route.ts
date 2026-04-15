import { NextResponse, type NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db, ensureSqlitePragma } from "@/lib/db";
import { now } from "@/lib/db/helpers";
import { teamMembers } from "@/lib/db/schema";
import { withErrorHandler, HttpError } from "@/lib/http";
import { getActorContext } from "@/lib/actor";
import { withAudit } from "@/lib/audit";
import { teamMemberUpdateSchema } from "@/lib/validation/teamMember";

type Params = { params: { id: string } };

/**
 * GET /api/team-members/:id
 */
export const GET = withErrorHandler(
  async (_req: NextRequest, { params }: Params) => {
    await ensureSqlitePragma();
    const rows = await db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.id, params.id), isNull(teamMembers.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new HttpError("NOT_FOUND", "팀원을 찾을 수 없습니다");
    return NextResponse.json(row);
  },
);

/**
 * PATCH /api/team-members/:id
 */
export const PATCH = withErrorHandler(
  async (req: NextRequest, { params }: Params) => {
    await ensureSqlitePragma();
    const actor = getActorContext(req);
    const input = teamMemberUpdateSchema.parse(await req.json());
    const updatedAt = now();

    const updated = db.transaction((tx) => {
      const before = tx
        .select()
        .from(teamMembers)
        .where(and(eq(teamMembers.id, params.id), isNull(teamMembers.deletedAt)))
        .limit(1)
        .get();
      if (!before) throw new HttpError("NOT_FOUND", "팀원을 찾을 수 없습니다");

      const after = {
        ...before,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        updatedAt,
      };

      tx.update(teamMembers).set(after).where(eq(teamMembers.id, params.id)).run();
      withAudit(tx, {
        entityType: "TeamMember",
        entityId: after.id,
        action: "UPDATE",
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
        actor,
      });
      return after;
    });

    return NextResponse.json(updated);
  },
);

/**
 * DELETE /api/team-members/:id
 * soft delete. WorkItem.assigneeId / CalendarEvent.memberId는
 * 스키마에서 onDelete: SetNull로 정의되어 있으나, soft delete이므로
 * 실제 FK는 유지된다. 필요 시 호출자가 정리.
 */
export const DELETE = withErrorHandler(
  async (req: NextRequest, { params }: Params) => {
    await ensureSqlitePragma();
    const actor = getActorContext(req);
    const deletedAt = now();

    db.transaction((tx) => {
      const before = tx
        .select()
        .from(teamMembers)
        .where(and(eq(teamMembers.id, params.id), isNull(teamMembers.deletedAt)))
        .limit(1)
        .get();
      if (!before) throw new HttpError("NOT_FOUND", "팀원을 찾을 수 없습니다");

      const after = { ...before, updatedAt: deletedAt, deletedAt };
      tx.update(teamMembers).set(after).where(eq(teamMembers.id, params.id)).run();
      withAudit(tx, {
        entityType: "TeamMember",
        entityId: after.id,
        action: "DELETE",
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
        actor,
      });
    });

    return new NextResponse(null, { status: 204 });
  },
);
