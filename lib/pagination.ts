import { and, asc, desc, isNotNull, isNull, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { z } from "zod";

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

const querySchema = z.object({
  cursor: z.string().min(1).max(2048).optional(),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
});

export function parsePagination(searchParams: URLSearchParams) {
  const parsed = querySchema.parse({
    cursor: searchParams.get("cursor") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
  });
  return { take: parsed.pageSize ?? DEFAULT_PAGE_SIZE, cursor: parsed.cursor };
}

type CursorValue = string | number | Date | null;
type StoredValue = string | number | null;
export type CursorKey<T> = {
  column: AnyColumn;
  value: (row: T) => CursorValue;
  direction: "asc" | "desc";
};

const cursorSchema = z.object({
  version: z.literal(1),
  scope: z.string(),
  values: z.array(z.union([z.string(), z.number().finite(), z.null()])),
}).strict();

function invalidCursor(): never {
  throw new z.ZodError([{ code: "custom", path: ["cursor"], message: "잘못된 페이지 커서입니다" }]);
}

/** Capture sort values so deleting the last row cannot restart the next page. */
export function encodeCursor(scope: string, values: CursorValue[]): string {
  const stored = values.map((value) => value instanceof Date ? value.getTime() : value);
  return `page:${Buffer.from(JSON.stringify({ version: 1, scope, values: stored })).toString("base64url")}`;
}

export function decodeCursor(cursor: string, scope: string): StoredValue[] {
  try {
    const parsed = cursorSchema.parse(JSON.parse(Buffer.from(cursor.slice(5), "base64url").toString("utf8")));
    if (!cursor.startsWith("page:") || parsed.scope !== scope) return invalidCursor();
    return parsed.values;
  } catch {
    return invalidCursor();
  }
}

/** SQLite lexicographic seek, including its ASC NULL-first / DESC NULL-last ordering. */
export function cursorCondition<T>(keys: CursorKey<T>[], values: StoredValue[]): SQL {
  if (keys.length !== values.length) return invalidCursor();
  const equalPrefix: SQL[] = [];
  const alternatives: SQL[] = [];
  keys.forEach((key, index) => {
    const stored = values[index];
    if (stored === null && key.column.notNull) return invalidCursor();
    if (stored !== null && (
      (key.column.dataType === "string" && typeof stored !== "string") ||
      ((key.column.dataType === "number" || key.column.dataType === "date") && typeof stored !== "number")
    )) return invalidCursor();
    const value = key.column.dataType === "date" && typeof stored === "number" ? new Date(stored) : stored;
    if (value instanceof Date && !Number.isFinite(value.getTime())) return invalidCursor();
    const bound = sql.param(value, key.column);
    const after = stored === null
      ? key.direction === "asc" ? isNotNull(key.column) : undefined
      : key.direction === "asc"
        ? sql`${key.column} > ${bound}`
        : or(sql`${key.column} < ${bound}`, key.column.notNull ? undefined : isNull(key.column));
    if (after) alternatives.push(and(...equalPrefix, after)!);
    equalPrefix.push(stored === null ? isNull(key.column) : sql`${key.column} = ${bound}`);
  });
  return or(...alternatives) ?? sql`0`;
}

export function createCursorPagination<T>(scope: string, keys: CursorKey<T>[]) {
  return {
    orderBy: keys.map((key) => key.direction === "asc" ? asc(key.column) : desc(key.column)),
    async condition(cursor: string | undefined, findLegacyRow: (id: string) => Promise<T | undefined>) {
      if (!cursor) return undefined;
      if (cursor.startsWith("page:")) return cursorCondition(keys, decodeCursor(cursor, scope));
      // Existing clients may still hold an ID cursor from before the pagination upgrade.
      if (cursor.length > 128) return invalidCursor();
      const row = await findLegacyRow(cursor);
      if (!row) return invalidCursor();
      return cursorCondition(keys, keys.map((key) => {
        const value = key.value(row);
        return value instanceof Date ? value.getTime() : value;
      }));
    },
    page(rows: T[], take: number) {
      const items = rows.slice(0, take);
      const last = items[items.length - 1];
      return {
        items,
        nextCursor: rows.length > take && last ? encodeCursor(scope, keys.map((key) => key.value(last))) : null,
      };
    },
  };
}
