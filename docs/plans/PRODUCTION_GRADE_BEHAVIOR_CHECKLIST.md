# Production-Grade Behavior Checklist (Skills Runtime)

Last updated: 2026-02-13
Scope: execute hardening tasks 1-8 (excluding eval rollout and SLO operations tasks 9-10).

## 1. Routing Authority (Single Winner)
- [x] Remove heuristic high-confidence short-circuit from final routing winner path.
- [x] Make semantic parse + closed-set LLM route the primary decision path.
- [x] Keep heuristic routing only as resilience fallback when LLM routing call fails.

Acceptance:
- Main winner is never selected by heuristics when LLM routing returns successfully.
- Heuristics are used only on hard failures (exceptions) from LLM route path.

## 2. Preflight Operational Override
- [x] Add deterministic operational override in preflight for action-like inbox/calendar requests.
- [x] Ensure casual wording with clear action intent still enters skills execution path.

Acceptance:
- "can you ... archive/schedule/reschedule..." requests do not get trapped in chat mode.

## 3. Ambiguous Reference Binding Before Clarification
- [x] Add deterministic binding for "that email/thread/message/last one" from source message/thread context.
- [x] Add deterministic binding for "that meeting/event/last one" when source event context exists.
- [x] Thread/message/event contextual bindings happen before missing-slot clarification.

Acceptance:
- If context is present, assistant executes instead of asking unnecessary clarification.

## 4. Capability Parity Guardrails
- [x] Add executor capability coverage guard for all baseline skill plan capabilities.
- [x] Fail closed with explicit startup/runtime error if baseline skills reference unsupported executor capability.

Acceptance:
- No baseline skill can silently route into `capability_not_implemented` at runtime.

## 5. Capability Error Taxonomy Normalization
- [x] Ensure capability failure helpers emit deterministic error codes.
- [x] Standardize transient/provider/auth/permission/invalid/not_found/unsupported signaling.

Acceptance:
- Executor normalization gets stable reason codes (not brittle provider-specific message blobs).

## 6. Mutation Safety: Idempotency + Retry Boundaries + Postcondition Strictness
- [x] Add per-step mutation idempotency keys in executor.
- [x] Cache per-step mutation result by idempotency key within execution cycle.
- [x] Use bounded retries with stricter behavior for mutating operations.
- [x] Enforce strict postcondition gate before reporting success.

Acceptance:
- Mutations are protected against duplicate execution inside same execution graph.
- Failed postconditions cannot report `"success"`.

## 7. Richer Policy/Approval Context
- [x] Pass richer operation/resource/recipient/item-count context into approval evaluation precheck.
- [x] Map capability-to-policy context with operation-level signals.

Acceptance:
- Approval engine can evaluate more than coarse tool-name-only decisions.

## 8. User-Facing Recovery UX
- [x] Improve deterministic blocked/failed messaging with one concrete next step.
- [x] Keep messages specific to category: missing context, policy block, transient/provider, unsupported.

Acceptance:
- Error replies are actionable and not generic.

---

## Explicitly Deferred
- [ ] Task 9: broad eval/canary rollout gates.
- [ ] Task 10: SLO dashboards/alerts/runbooks.

