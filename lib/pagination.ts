import { z } from "zod";
import { HttpError } from "@/lib/http";

/**
 * Cursor 기반 페이지네이션.
 *
 * 사용 예:
 *   const { take, cursor } = parsePagination(searchParams);
 *   const rows = await db.select().from(workItems).orderBy(desc(workItems.createdAt)).limit(take + 1);
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
 * 정렬된 결과(take+1 개)에서 items와 nextCursor를 분리.
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
  const cursorIndex = cursor === undefined ? -1 : rows.findIndex((row) => row.id === cursor);
  if (cursor !== undefined && cursorIndex === -1) {
    throw new HttpError("BAD_REQUEST", "목록이 변경되었습니다. 처음부터 다시 조회해주세요.");
  }
  const start = cursorIndex + 1;
  return toPage(rows.slice(start, start + take + 1), take);
}
