import { z } from "zod";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from "../enums";

export const auditLogListQuerySchema = z.object({
  entityType: z.enum(AUDIT_ENTITY_TYPES).optional(),
  entityId: z.string().min(1).optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  actorName: z.string().min(1).optional(),
});

export type AuditLogListQuery = z.infer<typeof auditLogListQuerySchema>;
