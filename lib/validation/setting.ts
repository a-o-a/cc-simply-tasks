import { z } from "zod";

export const settingUpdateSchema = z.object({
  service_name: z.string().min(1).max(100).optional(),
});

export type SettingUpdateInput = z.infer<typeof settingUpdateSchema>;
