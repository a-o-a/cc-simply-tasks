import { z } from "zod";
import { TODO_STATUSES } from "../enums";
import { cuidSchema, optionalIsoDateTimeSchema } from "./common";

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
  title: z.string().min(1).max(300).optional(),
  note: z.string().max(10_000).nullable().optional(),
  status: z.enum(TODO_STATUSES).optional(),
  dueDate: optionalIsoDateTimeSchema,
  order: z.number().int().optional(),
  assigneeId: cuidSchema.nullable().optional(),
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
  dueDateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dueDateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  include: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").filter(Boolean) : []))
    .pipe(z.array(z.string()).optional()),
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
