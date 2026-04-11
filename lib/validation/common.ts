import { z } from "zod";

export const cuidSchema = z.string().min(1);

export const isoDateTimeSchema = z
  .string()
  .datetime({ offset: true })
  .transform((v) => new Date(v));

export const optionalIsoDateTimeSchema = isoDateTimeSchema.optional().nullable();

export const kstDateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식이어야 합니다");
