# OpenClaw Runtime Transplant - Execution Status

Last updated: 2026-02-13
Branch: `codex/agent-runtime-rebuild-exec`
Main synced: yes (`origin/main`)

## Overall
- Goal: complete 10-epic rip-and-replace to an open-world runtime with rule-plane enforcement.
- Current: major runtime cutover completed; full parity and full legacy-rules deletion still in progress.

## Epic Status

### Epic 1 - Runtime Kernel Replacement
- Status: `completed (core)`
- Delivered:
  - `src/server/features/ai/runtime/{index.ts,session.ts,attempt.ts,loop.ts,response.ts,types.ts}`
  - `src/server/features/ai/message-processor.ts` routes through runtime.
  - Legacy preflight/planner path removed from message execution.
- Remaining:
  - None for core cutover.

### Epic 2 - Dynamic Tool Fabric
- Status: `completed`
- Delivered:
  - `src/server/features/ai/tools/fabric/{registry.ts,assembler.ts,policy-filter.ts,types.ts}`
  - `src/server/features/ai/tools/fabric/adapters/provider-schema.ts`
  - Tool-set assembly is dynamic and policy-wrapped.
  - Metadata-driven tool ordering heuristics based on request domain + mutation intent:
    - `src/server/features/ai/tools/fabric/policy-filter.ts`
    - `src/server/features/ai/runtime/session.ts`
- Remaining:
  - None for core dynamic assembly + ranking.

### Epic 3 - Internal Skill MD Hints
- Status: `completed`
- Delivered:
  - `src/server/features/ai/skills/{loader.ts,snapshot.ts,types.ts}`
  - Runtime loads in-repo `skills/**/SKILL.md` only (with `runtime: agent`).
- Remaining:
  - Expand quality of skill hint corpus; architecture is in place.

### Epic 4 - Open-World Planner/Executor Rebuild
- Status: `completed (core)`
- Delivered:
  - Legacy closed planner stack deleted.
  - Runtime executes tool-first via LLM + runtime capability executor.
  - Approval replay executes capability directly (no legacy skill resume).
  - Added explicit runtime planner module package:
    - `src/server/features/ai/runtime/planner/{builder.ts,validator.ts,types.ts,index.ts}`
  - Runtime loop now builds a pre-execution plan and logs planner telemetry:
    - `src/server/features/ai/runtime/loop.ts`
  - Runtime attempt prompt now consumes the validated plan:
    - `src/server/features/ai/runtime/attempt.ts`
  - High-confidence direct-read lane for single-step reads:
    - `src/server/features/ai/runtime/loop.ts`
- Remaining:
  - Add richer ambiguity-first clarification flow before planner for unresolved entities.

### Epic 5 - Rule Plane as Mandatory PDP
- Status: `completed (core)`
- Delivered:
  - `src/server/features/ai/policy/enforcement.ts` used on mutating capability execution.
  - Approval requests created via `ApprovalService`.
  - Rule-plane decisions gate runtime mutations.
- Remaining:
  - Expand reason-code coverage and analytics aggregation.

### Epic 6 - Inbox/Calendar Native Action Layer
- Status: `partial`
- Delivered:
  - Strong email/calendar capability surface running in runtime.
  - Added bounded concurrency / retry improvements:
    - `src/server/features/ai/tools/providers/email.ts`
    - `src/server/features/ai/tools/providers/calendar.ts`
    - `src/server/integrations/google/message.ts`
  - Runtime per-user concurrency limiter:
    - `src/server/features/ai/runtime/concurrency.ts`
  - Shared tool-common concurrency/retry utilities and provider adoption:
    - `src/server/features/ai/tools/common/{concurrency.ts,retry.ts}`
    - `src/server/features/ai/tools/providers/{email.ts,calendar.ts}`
- Remaining:
  - Split provider wrappers into first-class domain primitives under `tools/email/*` and `tools/calendar/*`.
  - Add idempotency-key utilities for mutating bulk operations.

### Epic 7 - Broad Capability Framework
- Status: `completed (core)`
- Delivered:
  - Tool packs framework added:
    - `src/server/features/ai/tools/packs/{manifest-schema.ts,loader.ts,registry.ts}`
  - Duplicate tool-name validation on pack load.
  - Pack dependency + feature-flag gating:
    - `src/server/features/ai/tools/packs/{manifest-schema.ts,loader.ts}`
- Remaining:
  - Expand to additional non-inbox/calendar internal packs.

### Epic 8 - Legacy Deletion & Simplification
- Status: `completed (runtime + rules legacy removal)`
- Delivered:
  - Deleted legacy planner/router/executor stacks.
  - Deleted legacy AI baseline skill contract trees no longer used in runtime path.
  - Deleted legacy rules stack and legacy rule-based server action entrypoints:
    - `src/server/features/rules/**`
    - `src/server/actions/rule.ts`
    - `src/server/actions/ai-rule.ts`
  - Removed remaining non-runtime imports referencing legacy `features/rules/*`.
- Remaining:
  - Continue opportunistic dead-code cleanup outside AI/runtime scope.

### Epic 9 - Rules Legacy Consolidation
- Status: `completed (core migration)`
- Delivered:
  - Policy-plane automation executor no longer imports legacy `features/rules/ai/execute`.
  - Rule-plane path is active in runtime capability layer.
  - Legacy `/api/rules` endpoints now run on canonical rule-plane services:
    - `src/app/api/rules/route.ts`
    - `src/app/api/rules/[id]/route.ts`
  - Policy aggregation no longer pulls legacy `listEmailRules`:
    - `src/server/features/policies/service.ts`
  - Webhook/account validation now checks canonical automation rules instead of legacy `rule` rows:
    - `src/server/features/webhooks/validate-webhook-account.ts`
  - Gmail webhook processing contracts removed legacy `rules` dependency and run through canonical automation execution path:
    - `src/app/api/google/webhook/types.ts`
    - `src/app/api/google/webhook/process-history-item.ts`
    - `src/app/api/google/webhook/process-history.ts`
    - `src/server/features/email/process-history.ts`
    - `src/server/features/webhooks/process-history-item.ts`
  - System rule config/constants migrated to policy-plane module:
    - `src/server/features/policy-plane/system-config.ts`
  - Learned-pattern persistence migrated to policy-plane module:
    - `src/server/features/policy-plane/learning-patterns.ts`
  - Draft lifecycle utilities migrated out of legacy rules path:
    - `src/server/features/email/draft-management.ts`
  - Remaining non-runtime imports rewired from legacy `features/rules/*` to new modules across webhook/reply-tracker/lib/action surfaces.
- Remaining:
  - Expand policy-plane analytics and reason-code observability.

### Epic 10 - Operational Cutover
- Status: `partial`
- Delivered:
  - Runtime-only execution on active message path.
  - Structured completion telemetry in runtime (`openworld.turn.completed`).
  - Main branch now includes runtime cutover commits.
- Remaining:
  - Add production-grade SLO dashboards/alerts for latency/error/429 metrics.
  - Final delete of residual compatibility surfaces and final cutover checklist signoff.
  - Complete migration from root `skills/` to in-repo runtime catalog only.

## Recently Landed Commits
- `5b5096f5d` Improve runtime answer quality and add per-user execution throttling
- `27a096b2e` Detach policy-plane automation from legacy rules runtime
- `02def2c71` Delete dead skill contract stack and isolate capability schema
- `a24eaf066` Remove legacy planner stack and harden open-world runtime execution
- `2e397477d` Replace legacy skill runtime with open-world tool runtime kernel

## Active Next Queue (Do Not Skip)
1. Add explicit runtime metric schema + alert-ready telemetry fields (latency buckets, 429 counters, retries).
2. Finalize cutover checklist and remove residual compatibility toggles/surfaces.
3. Continue pack expansion beyond inbox/calendar while preserving policy-plane enforcement.
