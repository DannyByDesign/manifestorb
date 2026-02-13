import { z } from "zod";

export const toolPackManifestSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    enabled: z.boolean().default(true),
    dependencies: z.array(z.string().min(1)).default([]),
    requiredFlags: z.array(z.string().min(1)).default([]),
    precedence: z.number().int().default(0),
    groups: z.array(z.string().min(1)).default([]),
    tools: z.array(z.string().min(1)).min(1),
  })
  .strict();

export type ToolPackManifest = z.infer<typeof toolPackManifestSchema>;
