import { z } from "zod";

export const workTicketCreateSchema = z.object({
  systemName: z.string().min(1).max(50),
  ticketNumber: z.string().min(1).max(100),
  ticketUrl: z.string().url().max(1000).optional().nullable(),
});

export const workTicketUpdateSchema = workTicketCreateSchema.partial();

export type WorkTicketCreateInput = z.infer<typeof workTicketCreateSchema>;
export type WorkTicketUpdateInput = z.infer<typeof workTicketUpdateSchema>;
