# Issue: WS-14 Governance and Lifecycle

## Problem
Memory systems handling personal interaction history need strict lifecycle and controls.

## Approach
Add retention, forget/export, redaction, and access-audit controls.

## Atomic Tasks
1. Define retention policies by memory class.
2. Add forget/export APIs.
3. Add memory access audit logging.
4. Add sensitive-value redaction checks pre-embedding.

## References
- https://docs.langchain.com/langgraph-platform/data-storage-and-privacy
- https://help.getzep.com/v2/memory

## DoD
- User-controllable and auditable memory lifecycle is production-ready.
