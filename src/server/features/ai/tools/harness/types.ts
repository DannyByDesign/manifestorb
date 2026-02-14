import type { ZodTypeAny } from "zod";
import type { RuntimeToolResult } from "@/server/features/ai/tools/contracts/tool-result";

export interface RuntimeCustomToolDefinition {
  name: string;
  label: string;
  description: string;
  inputSchema: ZodTypeAny;
  execute: (rawArgs: unknown) => Promise<RuntimeToolResult>;
}

export interface RuntimeToolHarness {
  builtInTools: RuntimeCustomToolDefinition[];
  customTools: RuntimeCustomToolDefinition[];
  toolLookup: Map<string, RuntimeCustomToolDefinition>;
}
