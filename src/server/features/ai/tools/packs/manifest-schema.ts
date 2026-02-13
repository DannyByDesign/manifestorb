import { z } from "zod";
import { capabilityNameSchema } from "@/server/features/ai/contracts/capability-contract";

export const toolPackManifestSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    enabled: z.boolean().default(true),
    capabilities: z.array(capabilityNameSchema).min(1),
  })
  .strict();

export type ToolPackManifest = z.infer<typeof toolPackManifestSchema>;
