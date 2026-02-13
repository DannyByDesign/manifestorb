import type { ZodTypeAny } from "zod";
import { assertProviderFacingSchemaSafety } from "@/server/lib/llms/schema-safety";

export function assertProviderCompatibleToolSchema(schema: ZodTypeAny, label: string): void {
  assertProviderFacingSchemaSafety({ schema, label });
}
