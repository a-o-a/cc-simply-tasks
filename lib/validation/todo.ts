import { z } from "zod";
import { TODO_STATUSES } from "../enums";
import { cuidSchema, optionalIsoDateTimeSchema, kstDateStringSchema, MAX_CHILD_ITEMS } from "./common";

const checklistItemSchema = z.object({
  content: z.string().trim().min(1).max(500),
  done: z.boolean().optional().default(false),
  order: z.number().int().optional(),
  assigneeId: cuidSchema.optional().nullable(),
});

export const todoCreateSchema = z.object({
  title: z.string().trim().min(1).max(300),
  note: z.string().max(10_000).optional().nullable(),
  status: z.enum(TODO_STATUSES).default("OPEN"),
  dueDate: optionalIsoDateTimeSchema,
  order: z.number().int().optional().default(0),
  assigneeId: cuidSchema.optional().nullable(),
  checklist: z.array(checklistItemSchema).max(MAX_CHILD_ITEMS).optional(),
});

export const todoUpdateSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  note: z.string().max(10_000).nullable().optional(),
  status: z.enum(TODO_STATUSES).optional(),
  dueDate: optionalIsoDateTimeSchema,
  order: z.number().int().optional(),
  assigneeId: cuidSchema.nullable().optional(),
  checklist: z.array(checklistItemSchema.extend({ id: cuidSchema.optional() })).max(MAX_CHILD_ITEMS).optional(),
}).refine((value) => {
  const ids = value.checklist?.flatMap((item) => item.id ? [item.id] : []) ?? [];
  return new Set(ids).size === ids.length;
}, {
  path: ["checklist"], message: "중복된 체크리스트 항목입니다",
});

export const todoListQuerySchema = z.object({
  status: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? (v
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean))
        : undefined,
    )
    .pipe(z.array(z.enum(TODO_STATUSES)).optional()),
  assigneeId: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").filter(Boolean) : undefined))
    .pipe(z.array(z.string()).optional()),
  title: z.string().max(300).optional(),
  dueDateFrom: kstDateStringSchema.optional(),
  dueDateTo: kstDateStringSchema.optional(),
  include: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").filter(Boolean) : []))
    .pipe(z.array(z.enum(["checklist"]))),
}).refine((value) => !value.dueDateFrom || !value.dueDateTo || value.dueDateFrom <= value.dueDateTo, {
  path: ["dueDateTo"], message: "조회 종료일은 시작일 이후여야 합니다",
});

export const todoChecklistCreateSchema = checklistItemSchema;

export const todoChecklistUpdateSchema = z.object({
  content: z.string().trim().min(1).max(500).optional(),
  done: z.boolean().optional(),
  order: z.number().int().optional(),
  assigneeId: cuidSchema.nullable().optional(),
});

export const todoChecklistReorderSchema = z.object({
  ids: z.array(cuidSchema).min(1).max(MAX_CHILD_ITEMS).refine((ids) => new Set(ids).size === ids.length, "중복된 체크리스트 항목입니다"),
});

export type TodoCreateInput = z.infer<typeof todoCreateSchema>;
export type TodoUpdateInput = z.infer<typeof todoUpdateSchema>;
export type TodoListQuery = z.infer<typeof todoListQuerySchema>;
export type TodoChecklistCreateInput = z.infer<typeof todoChecklistCreateSchema>;
export type TodoChecklistUpdateInput = z.infer<typeof todoChecklistUpdateSchema>;
