# Issue: Context + Memory Master Execution Backlog

## Context

Source plan:
- `docs/plans/AGENTIC_CONTEXT_MEMORY_MASTER_PLAN.md`

Goal:
- Execute the plan top-to-bottom with no regression to inbox/calendar action quality.
- Deliver best-in-class context/memory behavior for agentic email + calendar workflows.

## Execution Order (Strict)

- [x] 01: Runtime context pack wiring (`2026-02-16-ws01-runtime-context-pack-wiring.md`)
- [x] 02: Memory toolpack integration (`2026-02-16-ws02-memory-toolpack-integration.md`)
- [x] 03: Embedding schema/runtime guardrails (`2026-02-16-ws03-embedding-contract-guardrails.md`)
- [x] 04: Conversation embedding ingestion/backfill (`2026-02-16-ws04-conversation-embedding-pipeline.md`)
- [x] 05: Hybrid memory recall + rerank (`2026-02-16-ws05-hybrid-memory-recall.md`)
- [x] 06: Memory recording extension (`2026-02-16-ws06-memory-recording-extension.md`)
- [x] 07: Context pruning (`2026-02-16-ws07-context-pruning.md`)
- [x] 08: Overflow compaction + retry (`2026-02-16-ws08-overflow-compaction-retry.md`)
- [x] 09: Pre-compaction memory flush (`2026-02-16-ws09-precompaction-memory-flush.md`)
- [x] 10: Episodic + relationship schema (`2026-02-16-ws10-episodic-relationship-memory-schema.md`)
- [x] 11: Retrieval orchestrator (`2026-02-16-ws11-retrieval-orchestrator.md`)
- [x] 12: Context slot budgeting (`2026-02-16-ws12-context-slot-budgeting.md`)
- [x] 13: Eval harness + rollout gates (`2026-02-16-ws13-eval-harness-and-gates.md`)
- [x] 14: Governance + lifecycle controls (`2026-02-16-ws14-governance-and-lifecycle.md`)

## Global Acceptance Gates

1. Execution quality:
- No regression in action correctness for inbox/calendar tools.
- No increase in unsafe mutation behavior.

2. Memory quality:
- Improved retrieval precision/recall on eval set.
- Grounded/cited recall responses for high-stakes memory questions.

3. Runtime stability:
- Long-session context overflows reduced via pruning/compaction.
- Turn latency and token usage remain within target budgets.

## Required References (must be cited in each PR)

- LangGraph memory: https://docs.langchain.com/oss/javascript/langgraph/memory
- LangGraph add memory: https://docs.langchain.com/oss/javascript/langgraph/add-memory
- LlamaIndex memory: https://developers.llamaindex.ai/python/framework/module_guides/deploying/agents/memory/
- Letta memory blocks: https://docs.letta.com/guides/core-concepts/memory/memory-blocks
- Qdrant hybrid queries: https://qdrant.tech/documentation/concepts/hybrid-queries/
- Pinecone hybrid: https://docs.pinecone.io/guides/search/hybrid-search
- Weaviate hybrid: https://docs.weaviate.io/weaviate/search/hybrid
- ReAct paper: https://arxiv.org/abs/2210.03629
- MemGPT paper: https://arxiv.org/abs/2310.08560
- Self-RAG paper: https://arxiv.org/abs/2310.11511
