import { z } from "zod";

export const isoDateTimeSchema = z.string().datetime({ offset: true });

export const timeRangeSlotSchema = z.object({
  start: isoDateTimeSchema,
  end: isoDateTimeSchema.optional(),
  timezone: z.string().optional(),
});

export const participantSlotSchema = z.object({
  emails: z.array(z.string().email()).min(1),
});

export const sendWindowSlotSchema = z.object({
  sendAt: isoDateTimeSchema,
  timezone: z.string().optional(),
});

export const urgencyBandSlotSchema = z.enum(["low", "medium", "high", "critical"]);

export const threadReferenceSlotSchema = z.object({
  threadId: z.string().min(1).optional(),
  messageId: z.string().min(1).optional(),
});

export const slotValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  timeRangeSlotSchema,
  participantSlotSchema,
  sendWindowSlotSchema,
  threadReferenceSlotSchema,
  urgencyBandSlotSchema,
]);

export const resolvedSlotsSchema = z.record(z.string(), slotValueSchema);

export type ResolvedSlots = z.infer<typeof resolvedSlotsSchema>;
