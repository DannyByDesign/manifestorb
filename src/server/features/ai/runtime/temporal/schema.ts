import { z } from "zod";

export const temporalDateRangeSchema = z
  .object({
    after: z.string().min(1).optional(),
    before: z.string().min(1).optional(),
    timeZone: z.string().min(1).optional(),
    timezone: z.string().min(1).optional(),
  })
  .strict();

export const temporalSourceSchema = z
  .object({
    after: z.string().min(1).optional(),
    before: z.string().min(1).optional(),
    timeZone: z.string().min(1).optional(),
    timezone: z.string().min(1).optional(),
    query: z.string().optional(),
    text: z.string().optional(),
    referenceText: z.string().optional(),
    dateRange: temporalDateRangeSchema.optional(),
  })
  .passthrough();

export const temporalDefaultWindowSchema = z.enum([
  "none",
  "today",
  "next_7_days",
]);

export type TemporalSource = z.infer<typeof temporalSourceSchema>;
export type TemporalDefaultWindow = z.infer<typeof temporalDefaultWindowSchema>;
