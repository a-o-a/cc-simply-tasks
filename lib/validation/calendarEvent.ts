import { z } from "zod";
import { cuidSchema, isoDateTimeSchema } from "./common";

export const calendarEventCreateSchema = z
  .object({
    title: z.string().min(1).max(300),
    memberId: cuidSchema.optional().nullable(),
    startDateTime: isoDateTimeSchema,
    endDateTime: isoDateTimeSchema,
    allDay: z.boolean().default(false),
    note: z.string().max(2000).optional().nullable(),
  })
  .refine(
    (v) =>
      (v.startDateTime as Date).getTime() < (v.endDateTime as Date).getTime(),
    {
      message: "endDateTime은 startDateTime보다 이후여야 합니다",
      path: ["endDateTime"],
    },
  );

export const calendarEventUpdateSchema = z
  .object({
    title: z.string().min(1).max(300).optional(),
    memberId: cuidSchema.nullable().optional(),
    startDateTime: isoDateTimeSchema.optional(),
    endDateTime: isoDateTimeSchema.optional(),
    allDay: z.boolean().optional(),
    note: z.string().max(2000).nullable().optional(),
  })
  .refine(
    (v) =>
      !v.startDateTime ||
      !v.endDateTime ||
      (v.startDateTime as Date).getTime() < (v.endDateTime as Date).getTime(),
    {
      message: "endDateTime은 startDateTime보다 이후여야 합니다",
      path: ["endDateTime"],
    },
  );

export const calendarEventRangeQuerySchema = z.object({
  from: isoDateTimeSchema,
  to: isoDateTimeSchema,
  memberId: cuidSchema.optional(),
});

export type CalendarEventCreateInput = z.infer<typeof calendarEventCreateSchema>;
export type CalendarEventUpdateInput = z.infer<typeof calendarEventUpdateSchema>;
export type CalendarEventRangeQuery = z.infer<typeof calendarEventRangeQuerySchema>;
