# Follow-up: Unified Search Maturity Rollout

Date: 2026-02-17  
Status: Open

## Context
Foundational search corpus schema, indexing queue, worker endpoint, and initial connector hooks (email/calendar/rules) are now in place.

## Remaining work
1. Add backfill jobs per connector to build initial corpus for existing users.
2. Add ingestion checkpoints and cursor persistence usage in webhook/sync handlers.
3. Add corpus-first retrieval tests for sent/inbox/calendar/rule mixed queries.
4. Implement query rewrite + entity resolution + alias/typo expansion layer.
5. Upgrade ranking to feature-based scorer (behavioral/graph/authority/intent/freshness).
6. Cut over legacy provider-centric search logic so unified corpus path is authoritative.
7. Add replay tooling for failed indexing jobs and lag/freshness telemetry dashboards.

## Source of truth
Execution backlog:  
`/Users/dannywang/Projects/amodel/docs/plans/2026-02-17-unified-search-maturity-execution-backlog.md`
