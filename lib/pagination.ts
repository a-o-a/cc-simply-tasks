import { z } from "zod";

/**
 * Cursor 기반 페이지네이션.
 *
 * 사용 예:
 *   const { take, cursor } = parsePagination(searchParams);
 *   const rows = await db.select().from(workItems).orderBy(desc(workItems.createdAt));
 *   const { items, nextCursor } = toPage(rows, take);
 */

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 10000;

const querySchema = z.object({
  cursor: z.string().min(1).optional(),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .optional(),
});

export type PaginationParams = {
  take: number;
  cursor: string | undefined;
};

export function parsePagination(
  searchParams: URLSearchParams,
): PaginationParams {
  const parsed = querySchema.parse({
    cursor: searchParams.get("cursor") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
  });
  return {
    take: parsed.pageSize ?? DEFAULT_PAGE_SIZE,
    cursor: parsed.cursor,
  };
}

/**
 * findMany의 결과(take+1 개)에서 items와 nextCursor를 분리.
 */
export function toPage<T extends { id: string }>(
  rows: T[],
  take: number,
): { items: T[]; nextCursor: string | null } {
  if (rows.length > take) {
    const items = rows.slice(0, take);
    return { items, nextCursor: items[items.length - 1]?.id ?? null };
  }
  return { items: rows, nextCursor: null };
}

export function slicePageAfterCursor<T extends { id: string }>(
  rows: T[],
  cursor: string | undefined,
  take: number,
): { items: T[]; nextCursor: string | null } {
  const start =
    cursor === undefined
      ? 0
      : Math.max(
          0,
          rows.findIndex((row) => row.id === cursor) + 1,
        );
  return toPage(rows.slice(start, start + take + 1), take);
}
