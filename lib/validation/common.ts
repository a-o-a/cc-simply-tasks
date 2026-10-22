import { z } from "zod";

export const cuidSchema = z.string().min(1);

export const isoDateTimeSchema = z.iso
  .datetime({ offset: true })
  .transform((v) => new Date(v));

export const optionalIsoDateTimeSchema = isoDateTimeSchema.optional().nullable();

export const kstDateStringSchema = z.iso.date({ error: "유효한 YYYY-MM-DD 날짜여야 합니다" });
