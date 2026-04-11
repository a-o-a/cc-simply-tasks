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

export const workItemListQuerySchema = z.object({
  status: z.enum(STATUSES).optional(),
  assigneeId: cuidSchema.optional(),
  category: z.enum(CATEGORIES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  ticket: z.string().min(1).optional(),
});

export type WorkItemCreateInput = z.infer<typeof workItemCreateSchema>;
export type WorkItemUpdateInput = z.infer<typeof workItemUpdateSchema>;
export type WorkItemListQuery = z.infer<typeof workItemListQuerySchema>;
