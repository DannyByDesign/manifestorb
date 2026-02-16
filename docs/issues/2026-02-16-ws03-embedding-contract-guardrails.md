# Issue: WS-03 Embedding Contract Guardrails

## Problem
Embedding behavior relies on raw SQL/migrations and can drift from runtime expectations.

## Approach
Add semantic readiness checks and safe fallback mode.

## Atomic Tasks
1. Add startup/runtime checks for vector extension + required columns.
2. Add fallback behavior and telemetry for unavailable semantic path.
3. Add migration verifier script and CI hook.
4. Add integration smoke checks for semantic queries.

## Code Touchpoints
- `src/server/features/memory/embeddings/search.ts`
- `src/server/features/memory/embeddings/queue.ts`
- `src/server/features/memory/embeddings/service.ts`
- `prisma/migrations/*embedding*`

## References
- https://qdrant.tech/documentation/concepts/hybrid-queries/
- https://docs.pinecone.io/guides/search/hybrid-search
- OpenClaw ref: `/Users/dannywang/Projects/openclaw/src/memory/manager.ts`

## DoD
- Semantic retrieval never hard-fails user turns due to missing vector infra.
