# Issue: WS-05 Hybrid Memory Recall

## Problem
Keyword-only recall underperforms on paraphrase and complex memory queries.

## Approach
Use hybrid vector+lexical retrieval with weighted fusion and confidence output.

## Atomic Tasks
1. Replace keyword-only memory recall execution path.
2. Add fusion config (vectorWeight/textWeight/candidateMultiplier).
3. Add optional reranking and confidence thresholds.
4. Add retrieval quality tests.

## Code Touchpoints
- `src/server/features/ai/memory-tools.ts`
- `src/server/features/memory/embeddings/search.ts`

## References
- https://docs.pinecone.io/guides/search/hybrid-search
- https://docs.weaviate.io/weaviate/search/hybrid
- https://qdrant.tech/documentation/concepts/hybrid-queries/
- OpenClaw ref: `/Users/dannywang/Projects/openclaw/src/memory/hybrid.ts`

## DoD
- Memory recall uses hybrid retrieval in production.
