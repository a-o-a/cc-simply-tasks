import { z } from "zod";
import { CATEGORIES, PRIORITIES, STATUSES } from "../enums";
import { cuidSchema, optionalIsoDateTimeSchema } from "./common";

export const workItemCreateSchema = z
  .object({
    title: z.string().min(1).max(300),
    description: z.string().max(10_000).optional().nullable(),
    category: z.enum(CATEGORIES).default("ETC"),
    status: z.enum(STATUSES).default("DRAFT"),
    priority: z.enum(PRIORITIES).default("NORMAL"),
    order: z.number().int().default(0),
    assigneeId: cuidSchema.optional().nullable(),
    startDate: optionalIsoDateTimeSchema,
    endDate: optionalIsoDateTimeSchema,
    transferDate: optionalIsoDateTimeSchema,
  })
  .refine(
    (v) =>
      !v.startDate ||
      !v.endDate ||
      (v.startDate as Date).getTime() <= (v.endDate as Date).getTime(),
    { message: "endDate는 startDate 이후여야 합니다", path: ["endDate"] },
  );

export const workItemUpdateSchema = z
  .object({
    title: z.string().min(1).max(300).optional(),
    description: z.string().max(10_000).nullable().optional(),
    category: z.enum(CATEGORIES).optional(),
    status: z.enum(STATUSES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    order: z.number().int().optional(),
    assigneeId: cuidSchema.nullable().optional(),
    startDate: optionalIsoDateTimeSchema,
    endDate: optionalIsoDateTimeSchema,
    transferDate: optionalIsoDateTimeSchema,
  })
  .refine(
    (v) =>
      !v.startDate ||
      !v.endDate ||
      (v.startDate as Date).getTime() <= (v.endDate as Date).getTime(),
    { message: "endDate는 startDate 이후여야 합니다", path: ["endDate"] },
  );

/** 쉼표 구분 문자열 → 배열 변환 헬퍼 */
function csvEnum<T extends string>(values: readonly [T, ...T[]]) {
  return z
    .string()
    .optional()
    .transform((v) =>
      v ? (v.split(",").filter((s) => (values as readonly string[]).includes(s)) as T[]) : undefined,
    )
    .pipe(z.array(z.enum(values)).optional());
}

export const workItemListQuerySchema = z.object({
  status: csvEnum(STATUSES),
  assigneeId: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").filter(Boolean) : undefined))
    .pipe(z.array(z.string()).optional()),
  category: csvEnum(CATEGORIES),
  priority: csvEnum(PRIORITIES),
  ticket: z.string().min(1).optional(),
  transferDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type WorkItemCreateInput = z.infer<typeof workItemCreateSchema>;
export type WorkItemUpdateInput = z.infer<typeof workItemUpdateSchema>;
export type WorkItemListQuery = z.infer<typeof workItemListQuerySchema>;
