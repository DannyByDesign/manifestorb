# Search Maturity Phase 2 Follow-ups

Date: 2026-02-17  
Status: Closed

## Scope
Remaining enhancements after the unified-search hard cut to improve long-term relevance quality.

## Follow-up items
1. [done] Add dedicated memory connector ingestion into `SearchDocument` so memory retrieval is fully corpus-native.
2. [done] Add explicit interaction hooks to write richer `SearchSignal` events (`result_open`, `result_action`, `result_impression`) and calibrate behavioral priors.
3. [done] Add learned ranking weight calibration pipeline from offline eval sets (instead of static weighted fusion).
4. [done] Expand query intelligence with nickname-based typo/entity expansions for person matching.
5. [done] Add connector-level backfill/reindex orchestration endpoints for cold-start recovery.

## Notes
- Ranking calibration command: `bun run eval:search-calibrate`
- Eval corpus path: `tests/evals/search-ranking-corpus.jsonl`
- Runtime override: `UNIFIED_SEARCH_RANKING_WEIGHTS_JSON` (JSON blob with calibrated weights)
