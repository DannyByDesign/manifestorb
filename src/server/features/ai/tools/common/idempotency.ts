import { createHash } from "crypto";

export function createOperationIdempotencyToken(params: {
  scope: string;
  operation: string;
  entityId: string;
}): string {
  const base = `${params.scope}:${params.operation}:${params.entityId}`;
  return createHash("sha1").update(base).digest("hex");
}
