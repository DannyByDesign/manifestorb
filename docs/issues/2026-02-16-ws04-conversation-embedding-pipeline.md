# Issue: WS-04 Conversation Embedding Pipeline

## Problem
Conversation semantic retrieval is underfed because conversation embedding ingestion is incomplete.

## Approach
Expand queue + worker + backfill to include `ConversationMessage`.

## Atomic Tasks
1. Extend embedding queue job type.
2. Enqueue message embeddings on persisted user/assistant messages.
3. Add backfill script and progress metrics.
4. Add retrieval tests proving fresh message recall.

## Code Touchpoints
- `src/server/features/memory/embeddings/queue.ts`
- `src/server/features/ai/message-processor.ts`
- `src/server/scripts/backfill-embeddings.ts`

## References
- https://docs.langchain.com/oss/javascript/langgraph/add-memory
- OpenClaw ref: `/Users/dannywang/Projects/openclaw/src/memory/manager.ts`

## DoD
- New conversation messages searchable semantically within configured SLA.
