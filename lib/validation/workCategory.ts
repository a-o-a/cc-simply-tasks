import { z } from "zod";

const codeSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[\w-]+$/, "영문, 숫자, 하이픈, 언더스코어만 허용");

export const workCategoryCreateSchema = z.object({
  code: codeSchema,
  name: z.string().min(1).max(100),
});

export const workCategoryUpdateSchema = z.object({
  name: z.string().min(1).max(100),
});

export type WorkCategoryCreateInput = z.infer<typeof workCategoryCreateSchema>;
export type WorkCategoryUpdateInput = z.infer<typeof workCategoryUpdateSchema>;
