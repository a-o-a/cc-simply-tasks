import { NextResponse, type NextRequest } from "next/server";
import {
  and,
  asc,
  desc,
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
import { workItems, workTickets } from "@/lib/db/schema";
import { withErrorHandler } from "@/lib/http";
import { getActorContext } from "@/lib/actor";
import { withAudit } from "@/lib/audit";
import { parsePagination, slicePageAfterCursor } from "@/lib/pagination";
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
      ? lte(workItems.transferDate, new Date(`${filters.transferDateTo}T23:59:59+09:00`))
      : undefined,
  ].filter(Boolean);

  const rows = await db
    .select()
    .from(workItems)
    .where(and(...conditions))
    .orderBy(
      ...(filters.scope === "transferred"
        ? [desc(workItems.transferDate), desc(workItems.createdAt), desc(workItems.id)]
        : [asc(workItems.order), desc(workItems.createdAt), desc(workItems.id)]),
    );

  const { items: pageItems, nextCursor } = slicePageAfterCursor(rows, cursor, take);
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
  const input = workItemCreateSchema.parse(await req.json());
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

    if (input.tickets?.length) {
      await tx.insert(workTickets).values(
        input.tickets.map((ticket) => ({
          id: newId(),
          workItemId: row.id,
          systemName: ticket.systemName,
          ticketNumber: ticket.ticketNumber,
          createdAt: timestamp,
          updatedAt: timestamp,
          deletedAt: null,
        })),
      );
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
