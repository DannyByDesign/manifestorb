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
- Status: `completed (core) / partial (advanced controls)`
- Delivered:
  - `src/server/features/ai/tools/fabric/{registry.ts,assembler.ts,policy-filter.ts,types.ts}`
  - `src/server/features/ai/tools/fabric/adapters/provider-schema.ts`
  - Tool-set assembly is dynamic and policy-wrapped.
- Remaining:
  - Add finer-grained domain/risk/idempotency metadata-driven routing heuristics.

### Epic 3 - Internal Skill MD Hints
- Status: `completed`
- Delivered:
  - `src/server/features/ai/skills/{loader.ts,snapshot.ts,types.ts}`
  - Runtime loads in-repo `skills/**/SKILL.md` only (with `runtime: agent`).
- Remaining:
  - Expand quality of skill hint corpus; architecture is in place.

### Epic 4 - Open-World Planner/Executor Rebuild
- Status: `partial`
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
- Remaining:
  - Add confidence-gated branch behavior (execute direct deterministic plan for ultra-high-confidence single-step reads).

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
- Remaining:
  - Split provider wrappers into first-class domain primitives under `tools/email/*` and `tools/calendar/*`.
  - Add shared reusable retry/throttle/idempotency utilities (`tools/common/*`).

### Epic 7 - Broad Capability Framework
- Status: `partial`
- Delivered:
  - Tool packs framework added:
    - `src/server/features/ai/tools/packs/{manifest-schema.ts,loader.ts,registry.ts}`
  - Duplicate tool-name validation on pack load.
- Remaining:
  - Add multi-pack runtime onboarding workflow and pack-scoped dependency flags.

### Epic 8 - Legacy Deletion & Simplification
- Status: `partial`
- Delivered:
  - Deleted legacy planner/router/executor stacks.
  - Deleted legacy AI baseline skill contract trees no longer used in runtime path.
- Remaining:
  - Remove/replace remaining legacy non-runtime surfaces not yet migrated.
  - Continue deletion of obsolete modules once replacement paths are active.

### Epic 9 - Rules Legacy Consolidation
- Status: `partial`
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
- Remaining:
  - Full elimination of legacy `src/server/features/rules/**` and related API surfaces after parity replacement.
  - Migrate remaining routes/services still importing `@/features/rules/*`.

### Epic 10 - Operational Cutover
- Status: `partial`
- Delivered:
  - Runtime-only execution on active message path.
  - Structured completion telemetry in runtime (`openworld.turn.completed`).
  - Main branch now includes runtime cutover commits.
- Remaining:
  - Add production-grade SLO dashboards/alerts for latency/error/429 metrics.
  - Final delete of residual compatibility surfaces and final cutover checklist signoff.

## Recently Landed Commits
- `5b5096f5d` Improve runtime answer quality and add per-user execution throttling
- `27a096b2e` Detach policy-plane automation from legacy rules runtime
- `02def2c71` Delete dead skill contract stack and isolate capability schema
- `a24eaf066` Remove legacy planner stack and harden open-world runtime execution
- `2e397477d` Replace legacy skill runtime with open-world tool runtime kernel

## Active Next Queue (Do Not Skip)
1. Continue removal/migration of remaining `@/features/rules/*` imports and legacy rule endpoints.
2. Split inbox/calendar provider wrappers into reusable domain primitives and shared throttling utilities.
3. Add explicit runtime metric schema + alert-ready telemetry fields.
4. Add confidence-gated direct execution path for simple single-step read requests.
5. Finalize operational cutover checklist for full runtime-only path signoff.
