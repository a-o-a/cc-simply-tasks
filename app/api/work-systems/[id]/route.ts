import { NextResponse, type NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db, ensureSqlitePragma } from "@/lib/db";
import { now } from "@/lib/db/helpers";
import { workSystems } from "@/lib/db/schema";
import { withErrorHandler, HttpError } from "@/lib/http";
import { getActorContext } from "@/lib/actor";
import { withAudit } from "@/lib/audit";
import { workSystemUpdateSchema } from "@/lib/validation/workSystem";

type Params = { params: { id: string } };

export const PATCH = withErrorHandler(async (req: NextRequest, { params }: Params) => {
  await ensureSqlitePragma();
  const actor = getActorContext(req);
  const input = workSystemUpdateSchema.parse(await req.json());
  const updatedAt = now();

  const updated = db.transaction((tx) => {
    const before = tx
      .select()
      .from(workSystems)
      .where(and(eq(workSystems.id, params.id), isNull(workSystems.deletedAt)))
      .limit(1)
      .get();
    if (!before) throw new HttpError("NOT_FOUND", "작업 시스템을 찾을 수 없습니다");

    const after = { ...before, ...input, updatedAt };
    tx.update(workSystems).set(after).where(eq(workSystems.id, params.id)).run();
    withAudit(tx, {
      entityType: "WorkSystem",
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

  db.transaction((tx) => {
    const before = tx
      .select()
      .from(workSystems)
      .where(and(eq(workSystems.id, params.id), isNull(workSystems.deletedAt)))
      .limit(1)
      .get();
    if (!before) throw new HttpError("NOT_FOUND", "작업 시스템을 찾을 수 없습니다");

    const after = { ...before, updatedAt: deletedAt, deletedAt };
    tx.update(workSystems).set(after).where(eq(workSystems.id, params.id)).run();
    withAudit(tx, {
      entityType: "WorkSystem",
      entityId: after.id,
      action: "DELETE",
      before: before as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
      actor,
    });
  });

  return new NextResponse(null, { status: 204 });
});
