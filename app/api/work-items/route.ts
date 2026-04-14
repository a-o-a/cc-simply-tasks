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
  const activeStatuses = filters.status?.filter((s) => s !== "TRANSFERRED");

  const statusWhere =
    filters.scope === "transferred"
      ? { status: "TRANSFERRED" as const }
      : filters.scope === "active"
        ? activeStatuses && activeStatuses.length > 0
          ? { status: { in: activeStatuses } }
          : { status: { not: "TRANSFERRED" as const } }
        : filters.status?.length
          ? { status: { in: filters.status } }
          : {};
  const orderBy =
    filters.scope === "transferred"
      ? [{ transferDate: "desc" as const }, { createdAt: "desc" as const }, { id: "desc" as const }]
      : [{ order: "asc" as const }, { createdAt: "desc" as const }, { id: "desc" as const }];

  const rows = await prisma.workItem.findMany({
    where: {
      deletedAt: null,
      ...statusWhere,
      ...(filters.assigneeId?.length ? { assigneeId: { in: filters.assigneeId } } : {}),
      ...(filters.category?.length ? { category: { in: filters.category } } : {}),
      ...(filters.priority?.length ? { priority: { in: filters.priority } } : {}),
      ...(filters.title ? { title: { contains: filters.title } } : {}),
      ...(filters.requestType ? { requestType: { contains: filters.requestType } } : {}),
      ...(filters.requestor ? { requestor: { contains: filters.requestor } } : {}),
      ...(filters.requestNumber ? { requestNumber: { contains: filters.requestNumber } } : {}),
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
      ...(filters.systemCode?.length
        ? {
            tickets: {
              some: {
                deletedAt: null,
                systemName: { in: filters.systemCode },
              },
            },
          }
        : {}),
      ...(filters.hasTransferDate ? { transferDate: { not: null } } : {}),
      ...(filters.transferDate || filters.transferDateTo
        ? {
            transferDate: {
              ...(filters.transferDate
                ? { gte: new Date(`${filters.transferDate}T00:00:00+09:00`) }
                : {}),
              ...(filters.transferDateTo
                ? { lte: new Date(`${filters.transferDateTo}T23:59:59+09:00`) }
                : {}),
            },
          }
        : {}),
    },
    include: {
      assignee: true,
      tickets: {
        where: { deletedAt: null },
        select: { systemName: true, ticketNumber: true },
        orderBy: { createdAt: "asc" as const },
      },
    },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy,
  });

  const { items, nextCursor } = toPage(rows, take);
  return NextResponse.json({ items, nextCursor });
});

/**
 * POST /api/work-items
 * tickets 배열이 있으면 같은 트랜잭션에서 생성.
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
        additionalNotes: input.additionalNotes ?? null,
        category: input.category,
        status: input.status,
        priority: input.priority,
        order: input.order,
        assigneeId: input.assigneeId ?? null,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        transferDate: input.transferDate ?? null,
        requestType: input.requestType ?? null,
        requestor: input.requestor ?? null,
        requestNumber: input.requestNumber ?? null,
        requestContent: input.requestContent ?? null,
      },
    });

    if (input.tickets?.length) {
      for (const t of input.tickets) {
        await tx.workTicket.create({
          data: {
            workItemId: row.id,
            systemName: t.systemName,
            ticketNumber: t.ticketNumber,
          },
        });
      }
    }

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
