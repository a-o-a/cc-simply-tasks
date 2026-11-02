import { z } from "zod";

export const settingUpdateSchema = z.object({
  service_name: z.string().trim().min(1).max(100).optional(),
});

export type SettingUpdateInput = z.infer<typeof settingUpdateSchema>;
