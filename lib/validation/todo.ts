import { z } from "zod";
import { TODO_STATUSES } from "../enums";
import { cuidSchema, isoDateTimeSchema, kstDateStringSchema, optionalIsoDateTimeSchema } from "./common";

const checklistItemSchema = z.object({
  content: z.string().min(1).max(500),
  done: z.boolean().optional().default(false),
  order: z.number().int().optional().default(0),
  assigneeId: cuidSchema.optional().nullable(),
});

export const todoCreateSchema = z.object({
  title: z.string().min(1).max(300),
  note: z.string().max(10_000).optional().nullable(),
  status: z.enum(TODO_STATUSES).default("OPEN"),
  dueDate: optionalIsoDateTimeSchema,
  order: z.number().int().optional().default(0),
  assigneeId: cuidSchema.optional().nullable(),
  checklist: z.array(checklistItemSchema).optional(),
});

export const todoUpdateSchema = z.object({
  expectedUpdatedAt: isoDateTimeSchema.optional(),
  title: z.string().min(1).max(300).optional(),
  note: z.string().max(10_000).nullable().optional(),
  status: z.enum(TODO_STATUSES).optional(),
  dueDate: optionalIsoDateTimeSchema,
  order: z.number().int().optional(),
  assigneeId: cuidSchema.nullable().optional(),
  // When present, replace the active checklist in array order. Existing IDs
  // are preserved; new items omit their ID and receive one inside the transaction.
  checklist: z.array(checklistItemSchema.extend({ id: cuidSchema.optional() }))
    .refine((items) => {
      const ids = items.flatMap((item) => item.id ? [item.id] : []);
      return new Set(ids).size === ids.length;
    }, { error: "체크리스트 항목 ID가 중복되었습니다" })
    .optional(),
});

export const todoListQuerySchema = z.object({
  status: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? (v
            .split(",")
            .filter((s) =>
              (TODO_STATUSES as readonly string[]).includes(s),
            ) as Array<(typeof TODO_STATUSES)[number]>)
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
    .pipe(z.array(z.string())),
}).refine((input) => !input.dueDateFrom || !input.dueDateTo || input.dueDateFrom <= input.dueDateTo, {
  error: "종료일은 시작일 이후여야 합니다",
  path: ["dueDateTo"],
});

export const todoChecklistCreateSchema = checklistItemSchema;

export const todoChecklistUpdateSchema = z.object({
  content: z.string().min(1).max(500).optional(),
  done: z.boolean().optional(),
  order: z.number().int().optional(),
  assigneeId: cuidSchema.nullable().optional(),
});

export const todoChecklistReorderSchema = z.object({
  ids: z.array(cuidSchema).min(1),
});

export type TodoCreateInput = z.infer<typeof todoCreateSchema>;
export type TodoUpdateInput = z.infer<typeof todoUpdateSchema>;
export type TodoListQuery = z.infer<typeof todoListQuerySchema>;
export type TodoChecklistCreateInput = z.infer<typeof todoChecklistCreateSchema>;
export type TodoChecklistUpdateInput = z.infer<typeof todoChecklistUpdateSchema>;
