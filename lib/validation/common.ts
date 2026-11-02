import { z } from "zod";

export const cuidSchema = z.string().trim().min(1).max(128);
export const MAX_CHILD_ITEMS = 1000;

export const uniqueMemberIdsSchema = z.array(cuidSchema).max(MAX_CHILD_ITEMS).refine(
  (ids) => new Set(ids).size === ids.length,
  "중복된 팀원은 지정할 수 없습니다",
);

export const isoDateTimeSchema = z
  .string()
  .datetime({ offset: true })
  .transform((v) => new Date(v));

export const optionalIsoDateTimeSchema = isoDateTimeSchema.optional().nullable();

export const kstDateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식이어야 합니다")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "유효한 날짜여야 합니다");

/** Validate the merged persisted state, including one-sided PATCH requests. */
export function assertDateOrder(start: Date | null, end: Date | null, endField: string, allowEqual = false) {
  if (start && end && (allowEqual ? start.getTime() > end.getTime() : start.getTime() >= end.getTime())) {
    throw new z.ZodError([{ code: "custom", path: [endField], message: allowEqual ? "종료일은 시작일 이후여야 합니다" : "종료 시간은 시작 시간보다 이후여야 합니다" }]);
  }
}
