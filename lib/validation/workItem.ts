import { z } from "zod";
import { PRIORITIES, STATUSES } from "../enums";
import { cuidSchema, optionalIsoDateTimeSchema } from "./common";

export const WORK_ITEM_SCOPES = ["all", "active", "transferred"] as const;

const ticketRowSchema = z.object({
  systemName: z.string().min(1).max(100),
  ticketNumber: z.string().min(1).max(100),
});

export const workItemCreateSchema = z
  .object({
    title: z.string().min(1).max(300),
    description: z.string().max(10_000).optional().nullable(),
    category: z.string().max(100).default(""),
    status: z.enum(STATUSES).default("WAITING"),
    priority: z.enum(PRIORITIES).default("NORMAL"),
    order: z.number().int().default(0),
    assigneeId: cuidSchema.optional().nullable(),
    startDate: optionalIsoDateTimeSchema,
    endDate: optionalIsoDateTimeSchema,
    transferDate: optionalIsoDateTimeSchema,
    // 요청 정보
    requestType: z.string().max(200).optional().nullable(),
    requestor: z.string().max(200).optional().nullable(),
    requestNumber: z.string().max(200).optional().nullable(),
    requestContent: z.string().max(10_000).optional().nullable(),
    // 시스템 연동 티켓 (생성 시 함께 처리)
    tickets: z.array(ticketRowSchema).optional(),
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
    category: z.string().max(100).optional(),
    status: z.enum(STATUSES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    order: z.number().int().optional(),
    assigneeId: cuidSchema.nullable().optional(),
    startDate: optionalIsoDateTimeSchema,
    endDate: optionalIsoDateTimeSchema,
    transferDate: optionalIsoDateTimeSchema,
    // 요청 정보
    requestType: z.string().max(200).nullable().optional(),
    requestor: z.string().max(200).nullable().optional(),
    requestNumber: z.string().max(200).nullable().optional(),
    requestContent: z.string().max(10_000).nullable().optional(),
    // 시스템 연동 티켓 (수정 시 전체 대체)
    tickets: z.array(ticketRowSchema).optional(),
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
  scope: z.enum(WORK_ITEM_SCOPES).optional(),
  status: csvEnum(STATUSES),
  assigneeId: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").filter(Boolean) : undefined))
    .pipe(z.array(z.string()).optional()),
  category: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").filter(Boolean) : undefined))
    .pipe(z.array(z.string()).optional()),
  priority: csvEnum(PRIORITIES),
  ticket: z.string().min(1).optional(),
  transferDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  transferDateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type WorkItemCreateInput = z.infer<typeof workItemCreateSchema>;
export type WorkItemUpdateInput = z.infer<typeof workItemUpdateSchema>;
export type WorkItemListQuery = z.infer<typeof workItemListQuerySchema>;
