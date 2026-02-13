# OpenClaw Runtime Transplant - Execution Status

Last updated: 2026-02-13
Branch: `codex/agent-runtime-rebuild-exec`
Main synced: yes (`origin/main`)

## Overall
- Goal: complete 10-epic rip-and-replace to an open-world runtime with rule-plane enforcement.
- Current: epics implemented in-code, with legacy runtime/rules paths removed from active execution.

## Epic Status

### Epic 1 - Runtime Kernel Replacement
- Status: `completed`
- Delivered:
  - `src/server/features/ai/runtime/{index.ts,session.ts,attempt.ts,loop.ts,response.ts,types.ts}`
  - `src/server/features/ai/message-processor.ts` routes through runtime only.
  - Legacy orchestration preflight/planner hard-stop path removed from execution flow.

### Epic 2 - Dynamic Tool Fabric
- Status: `completed`
- Delivered:
  - `src/server/features/ai/tools/fabric/{registry.ts,assembler.ts,policy-filter.ts,types.ts}`
  - `src/server/features/ai/tools/fabric/adapters/provider-schema.ts`
  - Dynamic tool assembly with metadata-based ordering and policy wrapping.

### Epic 3 - Internal Skill MD Hints
- Status: `completed`
- Delivered:
  - `src/server/features/ai/skills/{loader.ts,snapshot.ts,types.ts}`
  - Runtime loads in-repo skill hints only.
  - Root-level `skills/` runtime artifacts migrated into in-repo runtime catalog.

### Epic 4 - Open-World Planner/Executor Rebuild
- Status: `completed`
- Delivered:
  - Runtime planner package:
    - `src/server/features/ai/runtime/planner/{builder.ts,validator.ts,types.ts,index.ts}`
  - Runtime plan telemetry + direct-read lane + repair path.
  - Clarification-first return when plan contains no executable steps and asks for missing context.

### Epic 5 - Rule Plane as Mandatory PDP
- Status: `completed`
- Delivered:
  - `src/server/features/ai/policy/enforcement.ts` governs mutating actions.
  - Runtime mutation path is rule-plane gated with approval creation through approval services.

### Epic 6 - Inbox/Calendar Native Action Layer
- Status: `completed`
- Delivered:
  - Domain primitive modules:
    - `src/server/features/ai/tools/email/primitives.ts`
    - `src/server/features/ai/tools/calendar/primitives.ts`
  - Capabilities migrated to use primitives (email/calendar).
  - Shared retry/concurrency/idempotency utilities:
    - `src/server/features/ai/tools/common/{retry.ts,concurrency.ts,idempotency.ts}`
  - Provider retry telemetry and retry-exhaustion logs for rate-limit handling.

### Epic 7 - Broad Capability Framework
- Status: `completed`
- Delivered:
  - Tool pack framework:
    - `src/server/features/ai/tools/packs/{manifest-schema.ts,loader.ts,registry.ts}`
  - Dependency/flag validation and duplicate tool-name detection on load.

### Epic 8 - Legacy Deletion & Simplification
- Status: `completed`
- Delivered:
  - Legacy planner/router/executor paths removed from active runtime.
  - Legacy rule stack removed:
    - `src/server/features/rules/**`
    - `src/server/actions/rule.ts`
    - `src/server/actions/ai-rule.ts`
  - Imports rewired to policy-plane and runtime-native modules.

### Epic 9 - Rules Legacy Consolidation
- Status: `completed`
- Delivered:
  - Rule APIs and webhook paths consolidated on canonical rule-plane services.
  - System config, learned-pattern persistence, and draft lifecycle moved to policy-plane-compatible modules.
  - Runtime observability additions for unsupported intent and precheck-failure categorization.

### Epic 10 - Operational Cutover
- Status: `completed`
- Delivered:
  - Runtime-only message execution on active path.
  - Structured runtime telemetry with schema validation:
    - `openworld.runtime.plan`
    - `openworld.runtime.direct_read`
    - `openworld.runtime.precheck_failed`
    - `openworld.runtime.clarification_required`
    - `openworld.turn.completed`
  - Cutover checklist added and maintained in-repo:
    - `docs/plans/openclaw-runtime-transplant/CUTOVER_CHECKLIST.md`
  - Note: per product direction, no dashboard artifact is included in this repo.

## Recently Landed Commits
- `5b5096f5d` Improve runtime answer quality and add per-user execution throttling
- `27a096b2e` Detach policy-plane automation from legacy rules runtime
- `02def2c71` Delete dead skill contract stack and isolate capability schema
- `a24eaf066` Remove legacy planner stack and harden open-world runtime execution
- `2e397477d` Replace legacy skill runtime with open-world tool runtime kernel
