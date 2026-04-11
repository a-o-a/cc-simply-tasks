import { NextResponse, type NextRequest } from "next/server";
import { prisma, ensureSqlitePragma } from "@/lib/db";
import { withErrorHandler } from "@/lib/http";
import { getActorContext } from "@/lib/actor";
import { withAudit } from "@/lib/audit";
import { parsePagination, toPage } from "@/lib/pagination";
import {
  workItemCreateSchema,
  workItemListQuerySchema,
} from "@/lib/validation/workItem";

/**
 * GET /api/work-items
 *   ?status, ?assigneeId, ?category, ?priority, ?ticket, ?cursor, ?pageSize
 *
 * soft delete 제외. tickets는 목록에서는 include하지 않음(상세에서만).
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  await ensureSqlitePragma();
  const { searchParams } = new URL(req.url);
  const filters = workItemListQuerySchema.parse(
    Object.fromEntries(searchParams),
  );
  const { take, cursor } = parsePagination(searchParams);

  const rows = await prisma.workItem.findMany({
    where: {
      deletedAt: null,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.assigneeId ? { assigneeId: filters.assigneeId } : {}),
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.priority ? { priority: filters.priority } : {}),
      ...(filters.ticket
        ? {
            tickets: {
              some: {
                deletedAt: null,
                ticketNumber: { contains: filters.ticket },
              },
            },
          }
        : {}),
    },
    include: {
      assignee: true,
    },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    // tie-breaker로 id 포함: order/createdAt이 같아도 안정적 정렬.
    orderBy: [{ order: "asc" }, { createdAt: "desc" }, { id: "desc" }],
  });

  const { items, nextCursor } = toPage(rows, take);
  return NextResponse.json({ items, nextCursor });
});

/**
 * POST /api/work-items
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  await ensureSqlitePragma();
  const actor = getActorContext(req);
  const input = workItemCreateSchema.parse(await req.json());

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.workItem.create({
      data: {
        title: input.title,
        description: input.description ?? null,
        category: input.category,
        status: input.status,
        priority: input.priority,
        order: input.order,
        assigneeId: input.assigneeId ?? null,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        transferDate: input.transferDate ?? null,
      },
    });
    await withAudit(tx, {
      entityType: "WorkItem",
      entityId: row.id,
      action: "CREATE",
      after: row as unknown as Record<string, unknown>,
      actor,
    });
    return row;
  });

  return NextResponse.json(created, { status: 201 });
});
