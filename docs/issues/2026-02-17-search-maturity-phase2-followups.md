# Search Maturity Phase 2 Follow-ups

Date: 2026-02-17  
Status: Open

## Scope
Remaining enhancements after the unified-search hard cut to improve long-term relevance quality.

## Follow-up items
1. Add dedicated memory connector ingestion into `SearchDocument` so memory retrieval is fully corpus-native.
2. Add explicit click/open interaction hooks to write richer `SearchSignal` events (`open`, `dismiss`, `pin`, `reply_from_result`) and calibrate behavioral priors.
3. Add learned ranking weight calibration pipeline from offline eval sets (instead of fixed static weights).
4. Expand typo/entity resolution with phonetic and nickname dictionaries for person/org matching.
5. Add connector-level backfill/reindex orchestration endpoints for cold-start recovery.
