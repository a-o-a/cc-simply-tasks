import { z } from "zod";

export const workSystemCreateSchema = z.object({
  code: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/, {
    message: "영문, 숫자, 하이픈, 언더스코어만 허용합니다",
  }),
  name: z.string().min(1).max(100),
});

export const workSystemUpdateSchema = workSystemCreateSchema.partial();

export type WorkSystemCreateInput = z.infer<typeof workSystemCreateSchema>;
export type WorkSystemUpdateInput = z.infer<typeof workSystemUpdateSchema>;
