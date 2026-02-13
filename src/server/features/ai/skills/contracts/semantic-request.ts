import { z } from "zod";

export const semanticIntentSchema = z.enum([
  "inbox_read",
  "inbox_mutate",
  "inbox_compose",
  "inbox_controls",
  "calendar_read",
  "calendar_mutate",
  "calendar_policy",
  "cross_surface_planning",
]);

export const semanticEntitySchema = z.object({
  key: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.record(z.string(), z.unknown())]),
  confidence: z.number().min(0).max(1).default(0.5),
}).strict();

export const semanticConstraintSchema = z.object({
  kind: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.record(z.string(), z.unknown())]),
}).strict();

export const semanticTaskSchema = z.object({
  id: z.string().min(1),
  intent: semanticIntentSchema,
  action: z.string().min(1),
  entities: z.array(semanticEntitySchema).default([]),
  constraints: z.array(semanticConstraintSchema).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
}).strict();

export const semanticRequestSchema = z.object({
  intents: z.array(semanticIntentSchema).default([]),
  tasks: z.array(semanticTaskSchema).default([]),
  policyHints: z.array(z.string()).default([]),
  unresolved: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
  raw: z.string().min(1),
}).strict();

export type SemanticIntent = z.infer<typeof semanticIntentSchema>;
export type SemanticTask = z.infer<typeof semanticTaskSchema>;
export type SemanticRequest = z.infer<typeof semanticRequestSchema>;
