import { createId } from "@paralleldrive/cuid2";
import { sql, type AnyColumn } from "drizzle-orm";

export function newId() {
  return createId();
}

export function now() {
  return new Date();
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

export function contains(column: AnyColumn, value: string) {
  return sql`${column} like ${`%${escapeLike(value)}%`} escape '\\'`;
}
