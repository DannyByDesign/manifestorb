# Issue: WS-06 Memory Recording Extension

## Problem
Current recording pipeline is strong but lacks richer episodic/relationship outputs.

## Approach
Extend extraction schema to emit structured relationship and commitment assertions.

## Atomic Tasks
1. Version extraction schema.
2. Add structured outputs for relationship + commitments.
3. Add contradiction handling and provenance checks.
4. Add tests for extraction validity and conflict resolution.

## References
- https://docs.mem0.ai/platform/quickstart
- https://docs.mem0.ai/api-reference/memory/add-memories
- https://help.getzep.com/v2/memory

## DoD
- Structured assertion outputs are persisted with provenance.
