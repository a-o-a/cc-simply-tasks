import { z } from "zod";

export const workTicketCreateSchema = z.object({
  systemName: z.string().trim().min(1).max(100),
  ticketNumber: z.string().trim().max(100),
});

export const workTicketUpdateSchema = workTicketCreateSchema.partial();

export type WorkTicketCreateInput = z.infer<typeof workTicketCreateSchema>;
export type WorkTicketUpdateInput = z.infer<typeof workTicketUpdateSchema>;
