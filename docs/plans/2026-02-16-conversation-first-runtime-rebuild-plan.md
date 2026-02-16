# Conversation-First Runtime Rebuild Plan (Latency + Reasoning)

**Status:** Ready for implementation
**Date:** 2026-02-16
**Authoring basis:** Code-only audit of current runtime + external research
**Non-negotiable constraint:** Remove brittle legacy routing paths immediately; preserve proven execution infrastructure (tool policy/filtering + capability/provider stack) and avoid long-lived dual architecture.

## 1. Objective

Rebuild the runtime so it behaves as a conversational assistant first, task executor second, while keeping low latency, strong recall, and reliable execution.

Success means:
1. Mixed turns (conversation + request + meta constraints) are parsed correctly.
2. Every turn gets memory-aware bootstrap context so conversational recall remains reliable.
3. Simple turns return quickly via progressive hydration deadlines, without sacrificing conversational quality.
4. Tool execution avoids timeout-prone scan loops for malformed or ambiguous filters.
5. User-facing replies stay natural and conversational for all non-hard-error outcomes, using exactly one writer pass.
6. The architecture is simpler than today by removing legacy fast-path/semantic routing and duplicate rewrite paths, while keeping existing tool-policy gating foundations.

---

## 2. Code-Only Current-State Map

### 2.1 Runtime call graph (current)

1. `src/server/features/ai/message-processor.ts:912` `processMessage(...)`
2. `src/server/features/ai/runtime/index.ts:10` `runOpenWorldRuntimeTurn(...)`
3. `src/server/features/ai/runtime/context/hydrator.ts:51` `hydrateRuntimeContext(...)`
4. `src/server/features/ai/runtime/session.ts:23` `createRuntimeSession(...)`
5. `src/server/features/ai/runtime/attempt-loop.ts:226` `runAttemptLoop(...)`
6. `src/server/features/ai/runtime/router.ts:137` `buildRuntimeRoutingPlan(...)`
7. `src/server/features/ai/runtime/fast-path.ts:703` `matchRuntimeFastPath(...)` (strict first)
8. `src/server/features/ai/runtime/response-writer.ts:109` `generateRuntimeUserReply(...)`
9. `src/server/features/channels/router.ts:280` `renderSurfaceResponseText(...)` second rewrite pass

### 2.2 Root-cause architecture issues (from code)

1. Fast-path parser runs before planner on every turn.
   - `src/server/features/ai/runtime/router.ts:143`
2. Fast-path applies regex extraction across the full utterance (no clause boundarying).
   - Sender scope: `src/server/features/ai/runtime/fast-path.ts:57`
   - Topic scope: `src/server/features/ai/runtime/fast-path.ts:59`
   - Sent mailbox phrase gap (`sent inbox` unsupported): `src/server/features/ai/runtime/fast-path.ts:40`
   - Date phrase gap (`this month` unsupported): `src/server/features/ai/runtime/fast-path.ts:50`
   - Sender/topic without explicit date drops path: `src/server/features/ai/runtime/fast-path.ts:588`
3. Semantic fallback is coarse lexical keywording, not discourse-aware.
   - `src/server/features/ai/runtime/semantic-contract.ts:348`
4. Email provider local filtering can page until timeout under bad filters.
   - Local filter gate: `src/server/features/ai/tools/providers/email.ts:310`
   - Paged loop: `src/server/features/ai/tools/providers/email.ts:432`
   - Timeout: `src/server/features/ai/tools/providers/email.ts:390`
5. Two LLM rewrite passes increase latency and can blur failure semantics.
   - Runtime rewrite: `src/server/features/ai/runtime/response-writer.ts:148`
   - Channel rewrite: `src/server/features/channels/router.ts:289`
6. Context hydration always happens before routing, even for simple conversational turns.
   - `src/server/features/ai/runtime/index.ts:33`

---

## 3. Research Synthesis -> Design Principles

### 3.1 What to adopt

1. Keep the simplest workable architecture; add complexity only where measured.
   - Anthropic: "Build with the simplest solution possible..."
2. Minimize model work for latency: fewer tokens, fewer round trips, shorter outputs.
   - OpenAI latency guidance.
3. Use caching of stable prompt/context prefixes.
   - OpenAI prompt caching and Anthropic prompt caching.
4. Keep tool catalogs small and dynamically scoped by intent.
   - OpenAI function-calling guidance (keep active function set small).
5. Use model routing/cascades: easy turns on lightweight path, complex turns on full planner.
   - FrugalGPT, RouteLLM.
6. Preserve reasoning+acting loop for non-trivial tasks.
   - ReAct.

### 3.2 Sources

1. [OpenAI latency optimization](https://platform.openai.com/docs/guides/latency-optimization)
2. [OpenAI prompt caching](https://platform.openai.com/docs/guides/prompt-caching)
3. [OpenAI function calling guide](https://platform.openai.com/docs/guides/function-calling)
4. [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
5. [Anthropic prompt caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)
6. [Anthropic adaptive thinking](https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking)
7. [ReAct paper](https://arxiv.org/abs/2210.03629)
8. [FrugalGPT paper](https://arxiv.org/abs/2305.05176)
9. [RouteLLM paper](https://arxiv.org/abs/2406.18665)

---

## 4. Target Architecture (Conversation-First)

## 4.1 New execution stages

1. **Stage A: Turn Compiler (discourse-aware, structured output)**
   - Decompose turn into `conversation_clauses`, `task_clauses`, `meta_constraints`, `execution_candidates`.
   - If confidence is low, abstain and route to planner or ask one clarification.
2. **Stage B: Route Decision**
   - `conversation_only` -> direct conversational reply (no tool).
   - `single_tool` -> validated one-shot tool call + direct response.
   - `planner` -> full ReAct-style loop.
3. **Stage C: Tool Guardrails**
   - Validate slots semantically before execution.
   - Reject impossible/suspicious slots (e.g., meta phrases as sender).
4. **Stage D: Provider Guardrails**
   - Bounded local-filter paging with deterministic abort behavior.
   - Prefer provider-native query constraints before local filtering.

## 4.2 Lanes (replace current lanes)

Replace `direct_response | macro_tool | planner_fast | planner_standard | planner_deep` with:
1. `conversation_only`
2. `single_tool`
3. `planner`

No recovery fast-path lane.

---

## 5. Atomic Implementation Plan

## Phase 0: Hard Cutover Prep (no dual architecture)

1. Create branch and baseline benchmarks for:
   - turn latency p50/p95
   - timeout rate
   - mixed-turn parse error rate
2. Freeze legacy fast-path tests as migration fixtures (do not preserve runtime path).

Code touchpoints:
- `src/server/features/ai/runtime/fast-path.test.ts` (copy fixtures to new decomposition tests)
- `src/server/features/ai/runtime/router.test.ts`

Definition of done:
- Baseline metrics captured and committed in plan notes/comments.

## Phase 1: Introduce Turn Compiler (new primary parser)

1. Add `src/server/features/ai/runtime/turn-compiler.ts`.
2. Define strict schema (Zod) for:
   - `conversationClauses: string[]`
   - `taskClauses: Array<{domain, action, target, constraints, confidence}>`
   - `metaConstraints: string[]`
   - `routeHint: "conversation_only" | "single_tool" | "planner"`
   - `needsClarification: boolean`
3. Implement compiler with `createGenerateObject` + compact prompt + low token budget.
4. Add deterministic guard post-processor:
   - map mailbox synonyms (`sent inbox`, `sent folder`, `outbox`) to sent scope
   - date phrase normalization includes `this month`, `last month`, `this quarter`
5. Add negative phrase sanitizer:
   - classify phrases like `not from our conversation memory` as meta constraint; never sender slot.

Code touchpoints:
- **New:** `src/server/features/ai/runtime/turn-compiler.ts`
- **New:** `src/server/features/ai/runtime/turn-compiler.test.ts`
- **Update:** `src/server/lib/llms/index.ts` (compiler call options helper if needed)

Definition of done:
- Compiler correctly handles mixed turn fixtures, including the exact incident prompt.

## Phase 2: Remove Fast Path Legacy Completely

1. Delete fast-path module and all callsites.
2. Remove `macro_tool` concept and strict/recovery matching logic.
3. Remove fast-path telemetry schema/events.

Code touchpoints:
- **Delete:** `src/server/features/ai/runtime/fast-path.ts`
- **Delete:** `src/server/features/ai/runtime/fast-path.test.ts`
- **Update:** `src/server/features/ai/runtime/router.ts`
- **Update:** `src/server/features/ai/runtime/attempt-loop.ts`
- **Update:** `src/server/features/ai/runtime/context/slot-budget.ts`
- **Update:** `src/server/features/ai/runtime/telemetry/schema.ts`
- **Update:** `src/server/features/ai/runtime/telemetry/schema.test.ts`

Definition of done:
- No runtime import/usage of `matchRuntimeFastPath` remains.

## Phase 3: Replace Semantic Contract with Turn Contract

1. Replace `semantic-contract.ts` with `turn-contract.ts` generated from compiler output.
2. Remove embedding-centroid intent classifier from routing-critical path.
3. Keep only minimal deterministic fallback if compiler fails hard.
4. Refactor tool candidate filtering to consume `TurnContract` instead of legacy semantic fields.

Code touchpoints:
- **Delete:** `src/server/features/ai/runtime/semantic-contract.ts`
- **Delete:** `src/server/features/ai/runtime/semantic-contract.test.ts`
- **New:** `src/server/features/ai/runtime/turn-contract.ts`
- **New:** `src/server/features/ai/runtime/turn-contract.test.ts`
- **Update:** `src/server/features/ai/runtime/session.ts`
- **Update:** `src/server/features/ai/tools/fabric/semantic-tool-candidate.ts` (rename + refactor)
- **Update:** `src/server/features/ai/tools/fabric/policy-filter.ts`

Definition of done:
- Session builds without embedding semantic classifier dependency for route/tool gating.

## Phase 4: Router + Attempt Loop Rebuild (Conversation-first)

1. Rebuild `buildRuntimeRoutingPlan(...)` to consume `TurnContract`.
2. New lane behavior:
   - `conversation_only`: produce direct conversational response.
   - `single_tool`: validate and execute one tool call.
   - `planner`: run multi-step loop.
3. Remove recovery lane and fallback loops that re-enter legacy parser.
4. Update runtime context slot budgets to new lane enum.

Code touchpoints:
- `src/server/features/ai/runtime/router.ts`
- `src/server/features/ai/runtime/attempt-loop.ts`
- `src/server/features/ai/runtime/context/slot-budget.ts`
- `src/server/features/ai/runtime/types.ts`

Definition of done:
- Mixed conversation+task turns no longer route through regex extraction.

## Phase 5: Remove Double Rewrite Architecture

1. Remove channel surface rewrite pass.
2. Keep a single runtime response writer pass for non-hard-error modes (`final`, `clarification`, `approval_pending`) to enforce natural conversational tone.
3. For hard runtime failures only, allow deterministic error fallback text.
4. Tighten runtime writer prompt contract to preserve facts while de-templating language.
5. Add tone regression tests to prevent robotic phrasing regressions.

Code touchpoints:
- `src/server/features/ai/runtime/attempt-loop.ts`
- `src/server/features/channels/router.ts`
- `src/server/features/ai/runtime/response-writer.ts` (retain as single conversational writer)
- `src/server/features/ai/runtime/result-summarizer.test.ts` (add natural-tone assertions where applicable)

Definition of done:
- Exactly one response-writer pass for non-hard-error turns, and no surface-level second rewrite.
- Tone tests verify non-robotic phrasing on representative task outputs.

## Phase 6: Email Slot Validation + Provider Guardrails

1. Add validator layer before email tool execution:
   - sender/to validation heuristics
   - forbidden meta phrase list
   - date-range sanity checks
2. Normalize sent scope and date scope from structured constraints.
3. In provider search loop, add hard bounds:
   - `MAX_LOCAL_FILTER_PAGES`
   - `MAX_LOCAL_FILTER_SCANNED`
4. Prefer provider-native query construction for attachment/sent/date combos before local filtering.
5. Return structured actionable errors (`invalid_slot`, `overbroad_filter`, `bounded_scan_exhausted`) instead of generic hiccup strings.

Code touchpoints:
- **New:** `src/server/features/ai/tools/runtime/capabilities/validators/email-search.ts`
- `src/server/features/ai/tools/runtime/capabilities/email.ts`
- `src/server/features/ai/tools/providers/email.ts`
- `src/server/features/ai/tools/runtime/capabilities/registry.ts` (if new filter fields are added)

Definition of done:
- No unbounded local-filter loops.
- Incident prompt no longer creates `from="our conversation memory"`.

## Phase 7: Latency Optimizations Without Losing Reasoning

1. Replace binary hydration with **progressive hydration tiers**:
   - Tier A (`bootstrap`, always-on): summary + pending state + short recent history + top semantic facts.
   - Tier B (`targeted`, conditional): retrieval slices based on turn contract (recall/question/task constraints).
   - Tier C (`expanded`, planner-heavy): full domain context (events/emails/tasks/attention items).
2. Move turn compilation ahead of hydration so retrieval can be scoped by intent/constraints.
3. Introduce hard per-tier deadlines and return best-available context on timeout:
   - Tier A target budget: 100-250ms.
   - Tier B target budget: 300-700ms.
   - Tier C runs only when required by planner depth or high uncertainty.
4. Run Tier B retrieval and capability/session prep in parallel after Tier A completes.
5. Use the existing semantic/policy/ranking filter pipeline for per-turn tool narrowing; do not add a second independent limiter. Calibrate current limits from telemetry (for example, tighten `single_tool` candidate sets when they are over-broad).
6. Add prompt-prefix caching hooks for stable compiler/system sections.
7. Never skip memory entirely for conversational turns; every turn gets Tier A bootstrap context.

Code touchpoints:
- `src/server/features/ai/runtime/index.ts`
- `src/server/features/ai/runtime/context/hydrator.ts`
- `src/server/features/memory/context-manager.ts`
- `src/server/features/memory/retrieval/orchestrator.ts`
- `src/server/features/ai/runtime/session.ts`
- `src/server/features/ai/tools/fabric/policy-filter.ts`
- `src/server/features/ai/runtime/telemetry/schema.ts`
- **New:** `src/server/features/ai/runtime/context/retrieval-broker.ts`

Definition of done:
- All turns include Tier A bootstrap memory context (including conversational recall turns).
- p50 latency improves for conversational and simple one-tool turns without recall regressions.
- Recall evals continue to pass while meeting latency SLO for Tier A.

## Phase 8: Tests + Evals + Regression Gates

1. Add unit tests for turn compiler decomposition and slot sanitization.
2. Add provider tests for bounded scan behavior.
3. Replace legacy fast-path tests with new route/decomposition tests.
4. Add eval suite for mixed-turn prompts in `tests/evals`.
5. Add CI gate for:
   - mixed-turn parse correctness
   - no generic fallback on slot sanitizable inputs
   - bounded search loop behavior

Code touchpoints:
- **New:** `src/server/features/ai/runtime/turn-compiler.test.ts`
- **New:** `src/server/features/ai/runtime/turn-contract.test.ts`
- `src/server/features/ai/runtime/router.test.ts`
- `src/server/features/ai/tools/providers/email.search.test.ts`
- **New:** `tests/evals/mixed-turn-routing-eval.test.ts`
- **New:** `tests/evals/mixed-turn-routing-corpus.json`

Definition of done:
- CI fails on reintroduction of full-utterance regex slot extraction behavior.

---

## 6. Explicit Legacy Removals (Required)

The following are removed, not feature-flagged:

1. `src/server/features/ai/runtime/fast-path.ts`
2. `src/server/features/ai/runtime/semantic-contract.ts`
3. Fast-path telemetry schema/event branch in `src/server/features/ai/runtime/telemetry/schema.ts`
4. Channel response rewrite usage in `src/server/features/channels/router.ts`
5. Duplicated rewrite architecture (runtime + surface rewrite in the same turn)

---

## 7. Migration Sequencing

1. Land Phase 1-3 together in one PR (compiler + contract + fast-path removal).
2. Land Phase 4-6 in second PR (router/attempt loop + provider guardrails).
3. Land Phase 7-8 in third PR (latency optimizations + eval gates).

No long-lived compatibility layer.

---

## 8. Acceptance Criteria (Release Gate)

1. Incident prompt class:
   - `Find all emails in my sent inbox containing invoice attachments from this month. do a fresh search in my sent inbox, not from our conversation memory`
   - Must route to valid sent search + monthly date range.
   - Must not create sender filter from meta text.
2. No `Email search timed out before your provider responded.` on sanitized single-tool searches under normal provider health.
3. Conversation-only turns should bypass planner/tooling and return in low-latency budget.
4. Tool timeout and bounded-scan failures return actionable clarification, not generic hiccup.
5. End-to-end mixed-turn eval pass rate >= 95% before rollout.
6. Tone eval set shows non-robotic conversational outputs for non-hard-error turns.

---

## 9. Risks and Mitigations

1. Risk: Compiler hallucinated structure.
   - Mitigation: strict schema + abstain path + slot validators.
2. Risk: Removing rewrite pass changes tone.
   - Mitigation: strengthen primary runtime system prompt and add tone snapshot tests.
3. Risk: Router regressions during lane collapse.
   - Mitigation: replace lane tests first, then implementation.
4. Risk: Provider query portability across Gmail/Outlook.
   - Mitigation: keep provider query construction capability-aware and fallback to bounded local filter.

---

## 10. Implementation Checklist

- [ ] Phase 0 complete
- [ ] Phase 1 complete
- [ ] Phase 2 complete
- [ ] Phase 3 complete
- [ ] Phase 4 complete
- [ ] Phase 5 complete
- [ ] Phase 6 complete
- [ ] Phase 7 complete
- [ ] Phase 8 complete
- [ ] Release gate accepted
