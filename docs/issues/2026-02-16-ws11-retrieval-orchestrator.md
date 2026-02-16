# Issue: WS-11 Retrieval Orchestrator

## Problem
Single-source retrieval misses cross-source context for person/thread/meeting recall.

## Approach
Build structured-first + hybrid + reranked retrieval orchestration.

## Atomic Tasks
1. Add intent-based query routing.
2. Add candidate fanout across structured and semantic stores.
3. Add fusion/rerank stage.
4. Add confidence and citation packaging.

## References
- https://qdrant.tech/documentation/advanced-tutorials/reranking-hybrid-search/
- https://arxiv.org/abs/2310.11511

## DoD
- Orchestrated retrieval improves eval relevance and groundedness.
