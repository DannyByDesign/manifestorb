# Semantic Runtime Hard-Cut Plan (Atomic)

**Date:** 2026-02-17
**Goal:** Permanent architecture fix for conversational nuance + scalable email retrieval.
**Constraint:** No legacy regex-first routing fallback. Keep one architecture.

## Research anchors (primary)
1. OpenAI function calling (strict structured outputs + constrained tools): https://platform.openai.com/docs/guides/function-calling
2. OpenAI latency optimization (parallelism, smaller prompts, fewer round-trips): https://platform.openai.com/docs/guides/latency-optimization
3. OpenAI prompt caching: https://platform.openai.com/docs/guides/prompt-caching
4. Anthropic building effective agents (simple orchestrator, explicit handoffs): https://www.anthropic.com/engineering/building-effective-agents
5. RAG (Lewis et al.): https://arxiv.org/abs/2005.11401
6. BEIR benchmark (hybrid retrieval realism): https://arxiv.org/abs/2104.08663
7. ColBERTv2 late interaction retrieval: https://arxiv.org/abs/2112.01488

## Root cause summary (current code)
1. `src/server/features/ai/runtime/turn-compiler.ts` still does full-utterance lexical/regex extraction for task routing and slots.
2. `src/server/features/ai/tools/runtime/capabilities/email.ts` still sends sender constraints as local filters, causing expensive local scan loops.
3. `src/server/features/ai/tools/providers/email.ts` local filtering can paginate until guardrail/timeout when filters are malformed or over-broad.

## Phase A: Turn compiler hard-cut to model-typed extraction
- [x] A1. Extend compiler schema with `singleToolCandidate` containing typed tool + args + candidate confidence.
  - File: `src/server/features/ai/runtime/turn-compiler.ts`
- [x] A2. Remove regex-derived single-tool construction path (`from/by/date` extraction on raw utterance).
  - File: `src/server/features/ai/runtime/turn-compiler.ts`
- [x] A3. Add model-output sanitization for tool args (sender/date/query/attachments).
  - File: `src/server/features/ai/runtime/turn-compiler.ts`
- [x] A4. Route to `planner` (not regex fallback) when model output is missing/low-confidence/ambiguous.
  - File: `src/server/features/ai/runtime/turn-compiler.ts`
- [x] A5. Expand relative date parser for `last N days`, `past N days`, `yesterday`, and week/month windows.
  - File: `src/server/features/ai/runtime/turn-compiler.ts`

## Phase B: Email search semantics + drift protection
- [x] B1. Add sender sanitization that strips temporal suffix drift (e.g., `Haseeb in the last 7 days`).
  - File: `src/server/features/ai/tools/runtime/capabilities/validators/email-search.ts`
- [x] B2. Build provider-native query from sender scope for non-destructive searches to avoid local filter scans.
  - File: `src/server/features/ai/tools/runtime/capabilities/email.ts`
- [x] B3. Resolve sender names via contacts before querying provider when possible.
  - File: `src/server/features/ai/tools/runtime/capabilities/email.ts`
- [x] B4. Keep strict local sender filter only for strict destructive/bulk paths.
  - File: `src/server/features/ai/tools/runtime/capabilities/email.ts`

## Phase C: Tests and regression gates
- [x] C1. Update turn compiler tests for hard-cut behavior in test-mode fallback.
  - File: `src/server/features/ai/runtime/turn-compiler.test.ts`
- [x] C2. Add validator unit tests for temporal-suffix sender drift normalization.
  - File: `src/server/features/ai/tools/runtime/capabilities/validators/email-search.test.ts`
- [x] C3. Add capability tests proving sender scope is converted to provider query and strict sender path remains strict.
  - File: `src/server/features/ai/tools/runtime/capabilities/email.timezone.test.ts`

## Implementation sequence (atomic)
1. Patch turn compiler schema + sanitizer helpers.
2. Remove regex single-tool path and switch fallback to planner.
3. Patch sender validator temporal stripping.
4. Patch capability email query planner + contact-assisted sender resolution.
5. Update/add tests.
6. Run targeted tests.
7. Run build.
8. Commit + push.

## Done criteria
1. No single-tool route depends on regex slot extraction from full raw utterance.
2. `Find emails from Haseeb in the last 7 days` no longer builds an over-broad local sender filter path.
3. Email search no longer hits local-filter guardrail for common sender/date lookups when provider query can represent constraints.
4. Conversation-only turns are preserved; ambiguous task extraction degrades to planner, not brittle hard filters.
