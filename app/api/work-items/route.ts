import { NextResponse, type NextRequest } from "next/server";
import {
  and,
  eq,
  exists,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
} from "drizzle-orm";
import { db, ensureSqlitePragma } from "@/lib/db";
import { contains, newId, now } from "@/lib/db/helpers";
import { hydrateWorkItems } from "@/lib/db/queries";
import { workItems, workTickets, type WorkItemRow } from "@/lib/db/schema";
import { withErrorHandler, readJsonBody } from "@/lib/http";
import { getActorContext } from "@/lib/actor";
import { withAudit } from "@/lib/audit";
import { parsePagination, createCursorPagination } from "@/lib/pagination";
import {
  workItemCreateSchema,
  workItemListQuerySchema,
} from "@/lib/validation/workItem";

/**
 * GET /api/work-items
 *   ?status, ?assigneeId, ?category, ?priority, ?ticket, ?cursor, ?pageSize
 *
 * soft delete 제외. 정렬키 커서와 DB LIMIT으로 페이지를 조회한다.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const GET = withErrorHandler(async (req: NextRequest) => {
  await ensureSqlitePragma();
  const { searchParams } = new URL(req.url);
  const filters = workItemListQuerySchema.parse(
    Object.fromEntries(searchParams),
  );
  const { take, cursor } = parsePagination(searchParams);
  const activeStatuses = filters.status?.filter((s) => s !== "TRANSFERRED");

  const conditions = [
    isNull(workItems.deletedAt),
    filters.scope === "transferred"
      ? eq(workItems.status, "TRANSFERRED")
      : filters.scope === "active"
        ? activeStatuses && activeStatuses.length > 0
          ? inArray(workItems.status, activeStatuses)
          : ne(workItems.status, "TRANSFERRED")
        : filters.status?.length
          ? inArray(workItems.status, filters.status)
          : undefined,
    filters.assigneeId?.length ? inArray(workItems.assigneeId, filters.assigneeId) : undefined,
    filters.category?.length ? inArray(workItems.category, filters.category) : undefined,
    filters.priority?.length ? inArray(workItems.priority, filters.priority) : undefined,
    filters.title ? contains(workItems.title, filters.title) : undefined,
    filters.requestType ? contains(workItems.requestType, filters.requestType) : undefined,
    filters.requestor ? contains(workItems.requestor, filters.requestor) : undefined,
    filters.requestNumber ? contains(workItems.requestNumber, filters.requestNumber) : undefined,
    filters.ticket
      ? exists(
          db
            .select({ id: workTickets.id })
            .from(workTickets)
            .where(
              and(
                eq(workTickets.workItemId, workItems.id),
                isNull(workTickets.deletedAt),
                contains(workTickets.ticketNumber, filters.ticket),
              ),
            ),
        )
      : undefined,
    filters.systemCode?.length
      ? exists(
          db
            .select({ id: workTickets.id })
            .from(workTickets)
            .where(
              and(
                eq(workTickets.workItemId, workItems.id),
                isNull(workTickets.deletedAt),
                inArray(workTickets.systemName, filters.systemCode),
              ),
            ),
        )
      : undefined,
    filters.hasTransferDate ? isNotNull(workItems.transferDate) : undefined,
    filters.transferDate
      ? gte(workItems.transferDate, new Date(`${filters.transferDate}T00:00:00+09:00`))
      : undefined,
    filters.transferDateTo
      ? lte(workItems.transferDate, new Date(`${filters.transferDateTo}T23:59:59.999+09:00`))
      : undefined,
  ].filter(Boolean);

  const pagination = createCursorPagination<WorkItemRow>(`work-items:${filters.scope === "transferred" ? "transferred" : "active"}`, [
    filters.scope === "transferred"
      ? { column: workItems.transferDate, value: (row) => row.transferDate, direction: "desc" }
      : { column: workItems.order, value: (row) => row.order, direction: "asc" },
    { column: workItems.createdAt, value: (row) => row.createdAt, direction: "desc" },
    { column: workItems.id, value: (row) => row.id, direction: "desc" },
  ]);
  const afterCursor = await pagination.condition(cursor, async (id) => {
    const [row] = await db.select().from(workItems).where(and(...conditions, eq(workItems.id, id))).limit(1);
    return row;
  });
  const rows = await db
    .select()
    .from(workItems)
    .where(and(...conditions, afterCursor))
    .orderBy(...pagination.orderBy)
    .limit(take + 1);

  const { items: pageItems, nextCursor } = pagination.page(rows, take);
  const items = await hydrateWorkItems(pageItems, "list");
  return NextResponse.json({ items, nextCursor });
});

/**
 * POST /api/work-items
 * tickets 배열이 있으면 같은 트랜잭션에서 생성.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  await ensureSqlitePragma();
  const actor = getActorContext(req);
  const input = workItemCreateSchema.parse(await readJsonBody(req));
  const timestamp = now();

  const created = await db.transaction(async (tx) => {
    const row = {
      id: newId(),
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
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    } satisfies typeof workItems.$inferInsert;
    await tx.insert(workItems).values(row);

    for (const ticket of input.tickets ?? []) {
      const ticketRow = {
        id: newId(),
        workItemId: row.id,
        systemName: ticket.systemName,
        ticketNumber: ticket.ticketNumber,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      };
      await tx.insert(workTickets).values(ticketRow);
      await withAudit(tx, { entityType: "WorkTicket", entityId: ticketRow.id, action: "CREATE", after: ticketRow, actor });
    }

    await withAudit(tx, {
      entityType: "WorkItem",
      entityId: row.id,
      action: "CREATE",
      after: { ...row, tickets: input.tickets ?? [] },
      actor,
    });
    return row;
  });

  return NextResponse.json(created, { status: 201 });
});
