import { z } from "zod";
import { MEMBER_ROLES } from "../enums";

export const teamMemberCreateSchema = z.object({
  name: z.string().min(1).max(100),
  role: z.enum(MEMBER_ROLES),
});

export const teamMemberUpdateSchema = teamMemberCreateSchema.partial();

export const teamMemberListQuerySchema = z.object({
  role: z.enum(MEMBER_ROLES).optional(),
});

export type TeamMemberCreateInput = z.infer<typeof teamMemberCreateSchema>;
export type TeamMemberUpdateInput = z.infer<typeof teamMemberUpdateSchema>;
export type TeamMemberListQuery = z.infer<typeof teamMemberListQuerySchema>;
