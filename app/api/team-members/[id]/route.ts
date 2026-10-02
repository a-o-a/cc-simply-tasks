import { NextResponse, type NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db, ensureSqlitePragma } from "@/lib/db";
import { now } from "@/lib/db/helpers";
import { teamMembers } from "@/lib/db/schema";
import { withErrorHandler, HttpError, readJsonBody } from "@/lib/http";
import { getActorContext } from "@/lib/actor";
import { withAudit } from "@/lib/audit";
import { teamMemberUpdateSchema } from "@/lib/validation/teamMember";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/team-members/:id
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const GET = withErrorHandler(
  async (_req: NextRequest, { params: paramsPromise }: Params) => {
    const params = await paramsPromise;
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
  async (req: NextRequest, { params: paramsPromise }: Params) => {
    const params = await paramsPromise;
    await ensureSqlitePragma();
    const actor = getActorContext(req);
    const input = teamMemberUpdateSchema.parse(await readJsonBody(req));
    const updatedAt = now();

    const updated = await db.transaction(async (tx) => {
      const beforeRows = await tx
        .select()
        .from(teamMembers)
        .where(and(eq(teamMembers.id, params.id), isNull(teamMembers.deletedAt)))
        .limit(1);
      const before = beforeRows[0];
      if (!before) throw new HttpError("NOT_FOUND", "팀원을 찾을 수 없습니다");

      const after = {
        ...before,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        updatedAt,
      };

      await tx.update(teamMembers).set(after).where(eq(teamMembers.id, params.id));
      await withAudit(tx, {
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
 * soft delete. 실제 FK와 과거 업무/일정의 팀원 관계는 유지된다.
 */
export const DELETE = withErrorHandler(
  async (req: NextRequest, { params: paramsPromise }: Params) => {
    const params = await paramsPromise;
    await ensureSqlitePragma();
    const actor = getActorContext(req);
    const deletedAt = now();

    await db.transaction(async (tx) => {
      const beforeRows = await tx
        .select()
        .from(teamMembers)
        .where(and(eq(teamMembers.id, params.id), isNull(teamMembers.deletedAt)))
        .limit(1);
      const before = beforeRows[0];
      if (!before) throw new HttpError("NOT_FOUND", "팀원을 찾을 수 없습니다");

      const after = { ...before, updatedAt: deletedAt, deletedAt };
      await tx.update(teamMembers).set(after).where(eq(teamMembers.id, params.id));
      await withAudit(tx, {
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
