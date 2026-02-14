# 2026-02-13 OpenClaw Runtime-First Inbox/Calendar Rip-and-Replace Plan

## Execution Tracker
Legend:
- `[ ]` not started
- `[-]` in progress
- `[x]` complete

Epics:
- `[x]` Epic 1: Hard Cut Runtime Entry To OpenClaw-Style Attempt Loop
- `[x]` Epic 2: Replace Capability Enum With Dynamic Tool Contracts
- `[x]` Epic 3: Dynamic Plugin/Packs With Conflict-Aware Registration
- `[x]` Epic 4: Skill Composition Rebuild
- `[x]` Epic 5: Replace Planner Stack With Tool-First Runtime Decisioning
- `[x]` Epic 6: Inbox/Calendar Native Tool Packs
- `[x]` Epic 7: Rule Plane Becomes Only Authority
- `[x]` Epic 8: Clean Database Redesign + Drift Elimination
- `[x]` Epic 9: Surface/API Latency + Response Contract Cleanup
- `[x]` Epic 10: Legacy Codebase Cleanup

Cutover Checks:
- `[x]` `rg "CapabilityName|capabilityNameSchema|executeRuntimeCapability|prisma\\.rule" src prisma`
- `[x]` Rule-plane-only mutation enforcement
- `[x]` Legacy tables/code paths removed
- `[x]` Runtime is single-path tool-first attempt loop

Remaining Work:
- None. Final follow-up items (legacy `Rule` table drop/backfill and `capability_execute` compatibility removal) completed on 2026-02-14.

## 1. Intent
This plan replaces the current closed-catalog capability/planner stack with an OpenClaw-style runtime-first architecture, while keeping policy-plane enforcement as the single source of truth for permissions, automations, and preferences.

This is a clean-cut migration plan. No legacy fallback runtime will remain after cutover.

## 2. Hard Constraints (Non-Negotiable)
- Closed capability enum routing is removed.
- Runtime is tool-first and dynamic; tools are assembled per request.
- Skills are Markdown capability hints only (not hard routing).
- Rule plane is the only authority for allow/deny/approval/automation/preference behavior.
- Database schema is cleaned to eliminate source-of-truth drift.
- No dashboards in scope.
- No tests in scope.

## 3. Baseline Reference (OpenClaw Patterns To Mirror)
- Runtime attempt loop:
  - `/Users/dannywang/Projects/openclaw/src/agents/pi-embedded-runner/run/attempt.ts`
- Dynamic tool assembly + policy filtering:
  - `/Users/dannywang/Projects/openclaw/src/agents/pi-tools.ts`
  - `/Users/dannywang/Projects/openclaw/src/agents/tool-policy.ts`
  - `/Users/dannywang/Projects/openclaw/src/plugins/tools.ts`
- Workspace + bundled + managed skill composition:
  - `/Users/dannywang/Projects/openclaw/src/agents/skills/workspace.ts`

## 4. Why Current Stack Is Still Below OpenClaw
1. Closed capability contract still exists.
- `src/server/features/ai/contracts/capability-contract.ts`
- `src/server/features/ai/capabilities/registry.ts`
- `src/server/features/ai/runtime/capability-executor.ts`

2. Tool packs are static wrappers around capability IDs, not real dynamic plugins.
- `src/server/features/ai/tools/packs/manifest-schema.ts`
- `src/server/features/ai/tools/packs/registry.ts`
- `src/server/features/ai/tools/packs/loader.ts`

3. Planner still emits capability IDs + `argsJson` repair flow.
- `src/server/features/ai/runtime/planner/builder.ts`
- `src/server/features/ai/runtime/planner/types.ts`
- `src/server/features/ai/runtime/planner/validator.ts`

4. Rule APIs are duplicated and partially overlapping.
- `src/app/api/rules/route.ts`
- `src/app/api/rules/[id]/route.ts`
- `src/app/api/rule-plane/route.ts`
- `src/app/api/rule-plane/[id]/route.ts`

5. Legacy rule models are still in active use and compete with canonical rule plane.
- `prisma/schema.prisma` models: `Rule`, `RuleHistory`, `ApprovalPreference`, `CalendarEventPolicy`
- `src/server/features/policy-plane/learning-patterns.ts`
- `src/server/features/preferences/service.ts` (newsletter toggle still writes `prisma.rule`)
- `src/server/features/reply-tracker/*` (`prisma.rule` reads)
- `src/app/api/google/webhook/process-label-removed-event.ts` (`prisma.rule` reads)

6. Schema drift risk remains for `TaskPreference` fields not backed by explicit migration.
- `prisma/schema.prisma` (`defaultMeetingDurationMin`, `meetingSlotCount`, `meetingExpirySeconds`)

## 5. Target Architecture (End State)
## 5.1 Runtime Flow
1. Inbound request enters one runtime entrypoint.
2. Runtime builds context + dynamic tool set.
3. LLM chooses/executes tools in a short attempt loop.
4. Each mutating call is pre-enforced by rule plane.
5. Results are synthesized into a direct response.
6. Pending clarification/approval uses one unified pending state model.

## 5.2 Tooling Model
- Tool identity is `tool.name` (string), not enum-based capability IDs.
- Packs/plugins can register/unregister tools dynamically.
- Tool registration is conflict-aware (name uniqueness + deterministic winner policy).
- Tool policy supports group allow/deny and provider/session overlays.

## 5.3 Skills Model
- Skills are local Markdown in repo only.
- Composition order: workspace > managed > bundled.
- Skills influence prompting only and never block execution.

## 5.4 Rule Plane Model
- Canonical rule plane is source-of-truth.
- Legacy models are removed or moved to projection tables only.
- Every mutating action logs policy decision + execution.

## 6. Epic Plan (File-Level and Code-Level)

## Epic 1: Hard Cut Runtime Entry To OpenClaw-Style Attempt Loop
### Goal
Collapse all AI turn handling into one runtime loop with no closed-catalog planner gate.

### Create
- `src/server/features/ai/runtime/attempt-loop.ts`
  - `runAttemptLoop(session)` with bounded attempts and tool-call iteration.
- `src/server/features/ai/runtime/tool-runtime.ts`
  - `buildRuntimeTurnContext(...)`
  - `executeToolCall(...)`
- `src/server/features/ai/runtime/finalize.ts`
  - `buildFinalUserResponse(...)`

### Update
- `src/server/features/ai/runtime/index.ts`
  - replace planner-first orchestration with attempt-loop orchestration.
- `src/server/features/ai/runtime/loop.ts`
  - fold into new attempt loop (or delete after migration).
- `src/server/features/ai/message-processor.ts`
  - remove planner-centric assumptions; call runtime entry only.
- `src/server/features/channels/executor.ts`
  - keep as thin adapter only.

### Delete
- `src/server/features/ai/runtime/attempt.ts` (if replaced entirely by `attempt-loop.ts`)
- `src/server/features/ai/runtime/response.ts` (if replaced by `finalize.ts`)

### Code-Level Decisions
- Eliminate “build plan then execute” as mandatory first step.
- Default to direct tool execution loop with short retries and deterministic stop conditions.
- Keep deterministic context precheck only for missing auth/account scope.

---

## Epic 2: Replace Capability Enum With Dynamic Tool Contracts
### Goal
Remove `CapabilityName` enum dependency from runtime execution path.

### Create
- `src/server/features/ai/tools/contracts/tool-contract.ts`
  - `ToolContract` type: `name`, `description`, `inputSchema`, `execute`, `metadata`.
- `src/server/features/ai/tools/contracts/tool-result.ts`
  - provider-safe result envelope.
- `src/server/features/ai/tools/registry/index.ts`
  - runtime registry keyed by `tool.name`.

### Update
- `src/server/features/ai/tools/fabric/types.ts`
  - switch from `capabilityId` to `toolName`.
- `src/server/features/ai/tools/fabric/assembler.ts`
  - execute tools by name, not capability switch.
- `src/server/features/ai/policy/enforcement.ts`
  - accept tool metadata from contract, not capability definition.
- `src/server/features/approvals/execute.ts`
  - replace `capability_execute` branch with `tool_execute` using new tool registry.

### Delete
- `src/server/features/ai/contracts/capability-contract.ts`
- `src/server/features/ai/runtime/capability-executor.ts`
- `src/server/features/ai/capabilities/*`

### Code-Level Decisions
- Remove giant switch execution; each tool owns its own `execute`.
- Runtime tool lookup failure returns actionable “unsupported tool” without crashing turn.

---

## Epic 3: Implement Dynamic Plugin/Packs With Conflict-Aware Registration
### Goal
Mirror OpenClaw plugin-style dynamic tool loading and conflict resolution.

### Create
- `src/server/features/ai/tools/plugins/types.ts`
- `src/server/features/ai/tools/plugins/loader.ts`
- `src/server/features/ai/tools/plugins/registry.ts`
- `src/server/features/ai/tools/plugins/policy.ts`

### Update
- `src/server/features/ai/tools/packs/manifest-schema.ts`
  - change `capabilities` to explicit `tools`.
- `src/server/features/ai/tools/packs/loader.ts`
  - load pack manifests + plugin tools, resolve conflicts.
- `src/server/features/ai/tools/packs/registry.ts`
  - remove hardcoded `core-inbox-calendar-policy` capability mapping.
- `src/server/features/ai/tools/fabric/registry.ts`
  - compose tool list from plugins/packs.
- `src/server/features/ai/tools/fabric/policy-filter.ts`
  - add group-based allow/deny + provider/session overlays.

### Delete
- Any pack logic that imports `listCapabilityDefinitions()`.

### Code-Level Decisions
- Registration collision policy:
  - default: fail startup with deterministic error.
  - optional override: explicit precedence in manifest.
- Support “group:*” policy entries similar to OpenClaw tool groups.

---

## Epic 4: Skill Composition Rebuild (Workspace + Managed + Bundled, Repo-Local Only)
### Goal
Mirror OpenClaw skill composition model while keeping all skills closed-source inside this repo.

### Create
- `src/server/features/ai/skills/workspace.ts`
  - discover workspace skills.
- `src/server/features/ai/skills/managed.ts`
  - discover managed/internal shared skills.
- `src/server/features/ai/skills/bundled.ts`
  - bundled baseline skills in repo.
- `src/server/features/ai/skills/composition.ts`
  - merge precedence and snapshot.
- `src/server/features/ai/skills/prompt.ts`
  - format composed skill prompt section.

### Update
- `src/server/features/ai/skills/loader.ts`
  - replace single-root loader with compositional loader.
- `src/server/features/ai/skills/snapshot.ts`
  - keep scoring lightweight; never block execution.
- `src/server/features/ai/runtime/session.ts`
  - use compositional skill snapshot builder.

### Move
- Move skill markdown files to one canonical internal location:
  - `src/server/features/ai/skills/catalog/**/SKILL.md`

### Delete
- Empty legacy dirs:
  - `src/server/features/ai/skills/router/`
  - `src/server/features/ai/skills/executor/`
  - `src/server/features/ai/skills/registry/`

### Code-Level Decisions
- Skill selection outputs prompt context only.
- Tool execution does not depend on skill match confidence.

---

## Epic 5: Replace Planner Stack With Tool-First Runtime Decisioning
### Goal
Remove closed planner contracts and use tool-first model output + validator + repair in-loop.

### Create
- `src/server/features/ai/runtime/decision/schema.ts`
  - provider-safe output schema for tool call proposals.
- `src/server/features/ai/runtime/decision/generate.ts`
  - LLM call for next tool action.
- `src/server/features/ai/runtime/decision/validate.ts`
  - strict schema + argument validation against selected tool contract.
- `src/server/features/ai/runtime/decision/repair.ts`
  - single repair pass for invalid tool args.

### Update
- `src/server/features/ai/runtime/planner/builder.ts`
  - replace with minimal compatibility wrapper or delete.
- `src/server/features/ai/runtime/planner/types.ts`
  - replace capability-centric types with tool-call decision types.
- `src/server/features/ai/runtime/planner/validator.ts`
  - validate by `tool.name` contract.
- `src/server/features/ai/runtime/loop.ts`
  - call decision/validate/execute iteratively.

### Delete
- `src/server/features/ai/runtime/planner/index.ts` (if obsolete)
- `src/server/features/ai/runtime/planner/builder.ts` (after replacement)

### Code-Level Decisions
- No “cannot build execution plan” hard-stop response.
- If decisioning fails, execute best-known direct read tool path or ask targeted clarification.

---

## Epic 6: Inbox/Calendar Native Tool Packs (High-Coverage Operations)
### Goal
Expose broad inbox/calendar action surface through composable tools with robust throttling.

### Create
- `src/server/features/ai/tools/packs/inbox/manifest.ts`
- `src/server/features/ai/tools/packs/inbox/tools/*.ts`
- `src/server/features/ai/tools/packs/calendar/manifest.ts`
- `src/server/features/ai/tools/packs/calendar/tools/*.ts`
- `src/server/features/ai/tools/common/throttle.ts`
- `src/server/features/ai/tools/common/backoff.ts`

### Update
- `src/server/features/ai/tools/providers/email.ts`
  - split monolith into granular tool implementations.
- `src/server/features/ai/tools/providers/calendar.ts`
  - split monolith into granular tool implementations.
- `src/server/integrations/google/message.ts`
  - move recursive retry handling to bounded queue worker style, reduce tail latency.
- `src/server/features/ai/tools/common/retry.ts`
  - unify transient retry semantics.

### Delete
- provider wrappers that bypass shared retry/throttle logic.

### Code-Level Decisions
- Each tool returns machine-readable references (`messageId`, `threadId`, `eventId`, `calendarId`).
- Limit concurrent Gmail fetch fanout to avoid 429 spikes.

---

## Epic 7: Rule Plane Becomes Only Authority
### Goal
Eliminate policy/rule duplication and make canonical rules the only decision source.

### Create
- `src/server/features/policy-plane/projections/preferences-projection.ts`
  - optional projection writer from canonical preference rules to fast-read snapshots.
- `src/server/features/policy-plane/projections/automation-projection.ts`
  - optional projection for trigger execution speed.

### Update
- `src/server/features/ai/policy/enforcement.ts`
  - always enforce via `evaluatePolicyDecision`.
- `src/server/features/policies/service.ts`
  - treat as read facade over policy-plane only.
- `src/app/api/rules/route.ts`
  - convert to compatibility shim that delegates to `/api/rule-plane`.
- `src/app/api/rules/[id]/route.ts`
  - same delegation.
- `src/app/api/rule-plane/route.ts`
  - canonical write/read endpoint.
- `src/app/api/rule-plane/[id]/route.ts`
  - canonical patch/delete endpoint.
- `src/server/features/policy-plane/learning-patterns.ts`
  - replace `prisma.rule` usage with canonical rule-plane interfaces.
- `src/server/features/preferences/service.ts`
  - remove direct `prisma.rule` writes in digest/newsletter flows.
- `src/server/features/reply-tracker/*`
  - migrate legacy `prisma.rule` reads to canonical query APIs.
- `src/app/api/google/webhook/process-label-removed-event.ts`
  - migrate `prisma.rule` references.

### Delete
- Any remaining code path that reads/writes `prisma.rule` directly.

### Code-Level Decisions
- Approval requirements are represented as canonical guardrail rules, not separate legacy preference objects.
- Automations are canonical `type=automation` rules with typed `actionPlan`.

---

## Epic 8: Clean Database Redesign + Drift Elimination
### Goal
Clean, migration-safe schema with one source of truth.

### Migration Order
1. Add missing columns/indexes for currently referenced `TaskPreference` fields.
2. Add unified pending runtime state model.
3. Backfill legacy rules/approval/calendar-policy into canonical rules.
4. Switch all reads/writes to canonical tables.
5. Drop legacy tables/columns.

### Prisma Changes
### Add
- `model PendingAgentTurnState` (replace split pending models)
  - fields: `status`, `userId`, `emailAccountId`, `provider`, `conversation/thread`, `correlationId`, `payload`, `expiresAt`.

### Keep (authoritative)
- `CanonicalRule`
- `CanonicalRuleVersion`
- `PolicyDecisionLog`
- `PolicyExecutionLog`
- `ApprovalRequest`
- `ApprovalDecision`
- `Conversation`
- `ConversationMessage`
- `EmailAccount`

### Demote/Drop (after backfill + cutover)
- `Rule`
- `RuleHistory`
- `ApprovalPreference`
- `CalendarEventPolicy`
- `PendingSkillRunState`
- `PendingPlannerRunState`

### Update
- `prisma/schema.prisma`
- new migration directory under `prisma/migrations/<timestamp>_openclaw_runtime_rule_plane_cleanup/`

### Code-Level Decisions
- Preference data is canonical rule data first; projection tables are optional caches only.
- No feature may treat projection tables as source of truth.

---

## Epic 9: Surface/API Latency + Response Contract Cleanup
### Goal
Fast, correct responses for simple requests and reliable behavior for complex ones.

### Create
- `src/server/features/ai/runtime/response-contract.ts`
- `src/server/features/ai/runtime/result-summarizer.ts`

### Update
- `src/app/api/chat/route.ts`
  - ensure runtime path alignment and remove stale assumptions.
- `src/server/features/channels/router.ts`
  - simplify outbound rendering to final runtime result contract.
- `src/server/features/ai/runtime/telemetry/schema.ts`
  - add deterministic latency and failure reason fields.
- `src/server/features/ai/runtime/telemetry/unsupported-intents.ts`
  - keep unsupported pattern capture for capability gap triage.

### Delete
- response shaping logic tied to planner-specific artifacts.

### Code-Level Decisions
- For “what’s my first email”, runtime must return the first resolved message summary if tool results contain messages.
- If upstream provider throttles, reply should indicate partial result + retry guidance, not fake completion.

---

## Epic 10: Legacy Codebase Cleanup (Final Pass)
### Goal
Leave one coherent architecture with no dead branches.

### Delete Directories
- `src/server/features/ai/orchestration/`
- `src/server/features/ai/planner/`
- `src/server/features/ai/provider-schemas/`
- `src/server/features/ai/capabilities/`
- `src/server/features/ai/skills/router/`
- `src/server/features/ai/skills/executor/`
- `src/server/features/ai/skills/registry/`

### Delete/Refactor Files
- `src/server/features/ai/contracts/capability-contract.ts`
- `src/server/features/ai/runtime/capability-executor.ts`
- `src/server/features/ai/tools/packs/registry.ts` (static capability mapping version)
- `src/server/features/ai/tools/packs/loader.ts` (capability-coupled version)
- `src/server/features/policy-plane/learning-patterns.ts` (legacy `prisma.rule` version)
- `src/server/features/calendar/safety-gate.ts` and `src/server/features/calendar/adaptive-replanner.ts`
  - remove `CalendarEventPolicy` dependencies; replace with canonical rule plane policy reads.

### API Cleanup
- Keep canonical endpoints:
  - `/api/rule-plane`
  - `/api/rule-plane/[id]`
- Remove duplicated compatibility endpoints after clients migrate:
  - `/api/rules`
  - `/api/rules/[id]`

### Documentation Cleanup
- Archive or replace stale docs under:
  - `docs/plans/agent-runtime-rebuild/*`
  - `docs/plans/openclaw-runtime-transplant/*`
- Keep one active source-of-truth architecture doc.

## 7. Schema-Mismatch Prevention Rules (Implementation Guardrails)
1. No provider-facing schema may include transforms/effects.
2. No unconstrained object branches in unioned output schemas.
3. No enum numeric/string type mismatch in provider schema payloads.
4. Tool input/output schema versions are static and validated at startup.
5. Startup hard-fails on:
   - duplicate tool names
   - invalid tool schema
   - unknown policy operation mapping
   - missing canonical rule-plane tables

## 8. Cutover Sequence
1. Epic 1-3 (runtime + dynamic tools + plugin loading)
2. Epic 4-5 (skills composition + planner removal)
3. Epic 6 (native inbox/calendar tool packs + reliability)
4. Epic 7 (rule-plane-only enforcement and API consolidation)
5. Epic 8 (schema cleanup + legacy model removal)
6. Epic 9 (latency + response contract cleanup)
7. Epic 10 (full legacy deletion)

No phase should ship with dual runtime paths.

## 9. Expected Product Behavior After Completion
- Agent can interpret broad natural language variations because it is no longer gated by closed capability family routing.
- Agent can execute complex inbox/calendar workflows through dynamic tool composition.
- Permissions/approvals/automations/preferences are enforced consistently by one policy authority.
- Database no longer drifts between legacy and canonical rule systems.
- Codebase is singular and clean, with no legacy planner/capability stack.

## 10. Full Repository Directory Coverage Matrix
This section maps the plan across every directory in this repository.  
Legend:
- `R`: primary rewrite target in this plan
- `M`: migration/adapter target (must be updated for compatibility)
- `K`: keep as-is (no planned architectural rewrite)
- `D`: planned delete/deprecate target

## 10.1 Top-Level Directories
- `.agent` -> `K` (local tooling metadata)
- `.cursor` -> `K` (editor metadata)
- `docs` -> `M` (replace stale architecture docs with this plan as source-of-truth)
- `generated` -> `M` (regenerate Prisma/types after schema cutover)
- `node_modules` -> `K` (dependency artifacts)
- `prisma` -> `R` (schema redesign, migration cleanup, legacy model removal)
- `public` -> `K` (static assets)
- `scripts` -> `M` (deploy/migrate scripts may need schema-step updates)
- `src` -> `R` (core architecture transplant)
- `surfaces` -> `M` (inbound adapters must align to new runtime contract)
- `tests` -> `K` for this execution scope (explicitly not prioritized)

## 10.2 `src` First-Level Coverage
- `src/app` -> `R` (API cutover, rule endpoint unification, runtime response contract)
- `src/components` -> `M` (only for API payload/contract adjustments)
- `src/enterprise` -> `K` (no runtime architecture rewrite required)
- `src/lib` -> `M` (shared client/server contracts may need updates)
- `src/server` -> `R` (runtime, tools, policies, rule-plane, integrations)
- `src/shaders` -> `K` (no relation to agent runtime)

## 10.3 `src/app/api` Coverage
- `ambiguous-time` -> `M` (approval/pending state compatibility)
- `approvals` -> `M` (tool_execute approval payloads, no capability enums)
- `calendar` -> `M` (tool/runtime contract alignment)
- `chat` -> `M` (single runtime entry contract)
- `context` -> `M` (context envelope consistency)
- `conversations` -> `M` (message persistence contract compatibility)
- `drafts` -> `M` (tool contract compatibility)
- `google` -> `M` (rule-plane-only logic, no `prisma.rule`)
- `health` -> `K`
- `integrations` -> `K`
- `jobs` -> `M` (scheduler/memory jobs may reference removed models)
- `notifications` -> `M` (approval/runtime result display contract)
- `privacy` -> `K`
- `rule-plane` -> `R` (canonical rule API source-of-truth)
- `rules` -> `D` (compat shim first, then remove)
- `schedule-proposal` -> `M` (pending state consolidation compatibility)
- `scheduled-actions` -> `M` (rule-plane automation contract)
- `slack` -> `M` (surface plumbing compatibility)
- `surfaces` -> `M` (runtime response and interactive payload contract)
- `tasks` -> `M` (calendar/task tool policy compatibility)

## 10.4 `src/server` Coverage
### `src/server/features` (every first-level directory)
- `ai` -> `R` (full runtime/tool/skills/planner transplant)
- `approvals` -> `R` (tool_execute approvals, canonical policy integration)
- `bulk-actions` -> `M` (mutating action policy hooks)
- `calendar` -> `R` (native tool pack split + policy integration; drop `CalendarEventPolicy` dependency)
- `categories` -> `M` (if automation/rule triggers reference legacy rules)
- `categorize` -> `M` (same reason as categories)
- `channels` -> `R` (single runtime invocation path + response contract)
- `clean` -> `M` (if rule references exist)
- `cold-email` -> `M` (remove `prisma.rule` dependencies)
- `conversations` -> `M` (pending state + response synthesis compatibility)
- `digest` -> `M` (rule-plane preference/automation projection compatibility)
- `drafts` -> `M` (tool pack integration)
- `email` -> `R` (native inbox tools and provider wrappers)
- `follow-up` -> `M` (automation contract compatibility)
- `groups` -> `M` (legacy rule/group coupling cleanup)
- `integrations` -> `M` (provider and token contracts)
- `knowledge` -> `K` (not runtime-critical for inbox/calendar baseline)
- `meeting-briefs` -> `M` (calendar tool contract compatibility)
- `memory` -> `K` (no required rewrite for this transplant)
- `notifications` -> `M` (new runtime outcome payloads)
- `organizations` -> `K`
- `policies` -> `R` (becomes canonical read facade over policy-plane only)
- `policy-plane` -> `R` (single policy authority + execution logging)
- `preferences` -> `R` (remove direct legacy rule writes)
- `premium` -> `K`
- `privacy` -> `K`
- `referrals` -> `K`
- `reply-tracker` -> `R` (remove `prisma.rule` reads)
- `reports` -> `M` (if rule-model assumptions exist)
- `scheduled` -> `M` (automation runtime compatibility)
- `snippets` -> `K`
- `tasks` -> `M` (task scheduling policy consistency)
- `web-chat` -> `M` (runtime result contract)
- `webhooks` -> `M` (canonical rules only)

### Other `src/server` first-level directories
- `actions` -> `M` (legacy action helpers may reference removed models/capabilities)
- `auth` -> `K`
- `db` -> `M` (schema and query updates)
- `integrations` -> `M` (gmail throttling and provider adapters)
- `lib` -> `M` (llm schema safety and runtime contracts)
- `packages` -> `K` unless imports break from API contract shifts
- `scripts` -> `M` (migration/bootstrap sequence updates)
- `types` -> `M` (tool/runtime type contracts)

## 10.5 `surfaces` Coverage
- `surfaces/prisma` -> `M` (if message/pending state schema changes are shared)
- `surfaces/src/db` -> `M`
- `surfaces/src/slack` -> `M`
- `surfaces/src/discord` -> `M`
- `surfaces/src/telegram` -> `M`
- `surfaces/src/jobs` -> `M`

## 10.6 Explicit Delete Coverage
Directories explicitly marked for deletion in this plan:
- `src/server/features/ai/orchestration`
- `src/server/features/ai/planner`
- `src/server/features/ai/provider-schemas`
- `src/server/features/ai/capabilities`
- `src/server/features/ai/skills/router`
- `src/server/features/ai/skills/executor`
- `src/server/features/ai/skills/registry`
- `/api/rules` route family after shim period

## 11. Fresh Agent Handoff Context (Implementation-Ready)
Use this section as the bootstrap for a new coding agent taking over.

## 11.1 Mission
Deliver an OpenClaw-style runtime-first inbox/calendar agent in this repo, with:
- dynamic tool loading
- markdown skill composition as hints
- rule-plane-only permission/automation/preference enforcement
- legacy architecture removed

## 11.2 Immediate Ground Rules
- Do not introduce or preserve a closed capability enum routing path.
- Do not keep dual runtime paths past cutover.
- Do not reintroduce direct `prisma.rule` writes/reads.
- Do not rely on planner-only execution for simple requests.

## 11.3 First Files To Read Before Editing
1. `/Users/dannywang/.codex/worktrees/ad4b/amodel/docs/plans/2026-02-13-openclaw-runtime-first-inbox-calendar-rip-replace-plan.md`
2. `/Users/dannywang/.codex/worktrees/ad4b/amodel/src/server/features/ai/runtime/index.ts`
3. `/Users/dannywang/.codex/worktrees/ad4b/amodel/src/server/features/ai/runtime/loop.ts`
4. `/Users/dannywang/.codex/worktrees/ad4b/amodel/src/server/features/ai/tools/fabric/assembler.ts`
5. `/Users/dannywang/.codex/worktrees/ad4b/amodel/src/server/features/policy-plane/pdp.ts`
6. `/Users/dannywang/.codex/worktrees/ad4b/amodel/prisma/schema.prisma`

Reference implementation style to mirror:
- `/Users/dannywang/Projects/openclaw/src/agents/pi-embedded-runner/run/attempt.ts`
- `/Users/dannywang/Projects/openclaw/src/agents/pi-tools.ts`
- `/Users/dannywang/Projects/openclaw/src/plugins/tools.ts`
- `/Users/dannywang/Projects/openclaw/src/agents/skills/workspace.ts`

## 11.4 Execution Order (Strict)
1. Runtime loop replacement
2. Dynamic tool contract replacement (remove capability enum path)
3. Plugin/pack loader with conflict-aware registration
4. Skills composition replacement
5. Planner-to-tool decisioning refactor
6. Native inbox/calendar tool pack split
7. Rule-plane-only enforcement + API consolidation
8. Prisma migration/backfill/drop legacy tables
9. Response/latency contract cleanup
10. Legacy directory deletion pass

## 11.5 Drift-Prevention Checklist
Before each epic is marked complete:
- `rg "capabilityNameSchema|CapabilityName|executeRuntimeCapability|prisma\\.rule"` returns expected residuals only.
- No endpoint writes to both canonical and legacy rule models.
- No new provider schema safety violations in `src/server/lib/llms/schema-safety.ts` checks.
- All mutating tools pass through `policy-plane` decision evaluation.

## 11.6 Done Definition
The migration is done only when:
- closed capability stack is removed
- runtime is tool-first and dynamic
- rule plane is sole policy authority
- legacy rule/policy tables and code paths are removed
- inbox/calendar requests execute through native tool packs without plan-build dead-ends

## 12. PRD-Level Atomic Execution Spec (Per Bullet)
This section expands every implementation bullet into:
- problem to solve
- approach and why
- expected outcome
- references

## 12.1 External Reference Index
- `GEMINI-STRUCTURED`: [Google Gemini Structured Outputs](https://ai.google.dev/gemini-api/docs/structured-output)
- `GMAIL-ERRORS`: [Gmail API error handling and 429 concurrency limits](https://developers.google.com/workspace/gmail/api/guides/handle-errors)
- `GMAIL-BATCH`: [Gmail API batching limits and recommendations](https://developers.google.com/workspace/gmail/api/guides/batch)
- `CAL-QUOTA`: [Google Calendar API quota guidance](https://developers.google.com/calendar/api/guides/quota)
- `OPENAI-STRUCTURED`: [OpenAI Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs/supported-models)
- `OPENAI-FUNCTIONS`: [OpenAI function/tool calling practices](https://platform.openai.com/docs/guides/function-calling/how-do-i-ensure-the-model-calls-the-correct-function)
- `ANTHROPIC-TOOLS`: [Anthropic tool-use implementation](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use)
- `PRISMA-PROD`: [Prisma migrate development vs production](https://www.prisma.io/docs/concepts/components/prisma-migrate/migrate-development-production)
- `MCP-SPEC`: [Model Context Protocol specification overview](https://modelcontextprotocol.io/specification/2025-11-25/basic)
- `OWASP-PROMPT-INJ`: [OWASP LLM Prompt Injection Prevention](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)
- `AI-SDK`: [Vercel AI SDK docs](https://vercel.com/docs/ai-sdk)

## 12.2 OpenClaw vs Current Root-Cause Context (for fresh agent)
### Why OpenClaw feels better operationally
- It runs a runtime-first attempt loop where tool execution is the primary unit.
- It uses dynamic tool composition and policy filtering at runtime.
- It uses compositional skill prompting (workspace/managed/bundled) without hard skill gating.
- It treats tool contract quality as core runtime reliability, not a side concern.

### Why current implementation still fails basic requests under load/variation
- Closed capability enum and planner artifacts still shape execution.
- Static tool pack registry still depends on capability IDs.
- Duplicate rule APIs and legacy rule model dependencies create behavior divergence.
- Gmail request concurrency and retry patterns can amplify 429 latency.
- Schema mismatches still occur when provider constraints differ from local schemas.

OpenClaw source anchors for fresh agent:
- `/Users/dannywang/Projects/openclaw/src/agents/pi-embedded-runner/run/attempt.ts`
- `/Users/dannywang/Projects/openclaw/src/agents/pi-tools.ts`
- `/Users/dannywang/Projects/openclaw/src/plugins/tools.ts`
- `/Users/dannywang/Projects/openclaw/src/agents/skills/workspace.ts`

## 12.3 Epic 1 Atomic Specs
### E1-C1 `src/server/features/ai/runtime/attempt-loop.ts`
- Problem: planner-first flow adds latency and brittle failure points before action.
- Approach: implement a bounded tool-call loop with deterministic stop reasons (`completed`, `needs_clarification`, `approval_pending`, `runtime_error`).
- Why: OpenClaw-style attempt loops handle messy request permutations better than static plan gates.
- Expected outcome: request execution no longer hard-fails on plan-build path.
- Refs: `ANTHROPIC-TOOLS`, `OPENAI-FUNCTIONS`, OpenClaw attempt loop file.

### E1-C2 `src/server/features/ai/runtime/tool-runtime.ts`
- Problem: runtime context and tool execution responsibilities are spread and coupled.
- Approach: isolate context hydration, tool lookup, tool execution, and tool-result normalization.
- Why: separation reduces hidden coupling and makes policy hooks deterministic.
- Expected outcome: single execution API for all tools across channels.
- Refs: `AI-SDK`, OpenClaw `pi-tools.ts`.

### E1-C3 `src/server/features/ai/runtime/finalize.ts`
- Problem: response shaping is coupled to planner artifacts and can misreport outcomes.
- Approach: synthesize final response from executed tool outcomes only.
- Why: prevents fabricated success and improves user trust.
- Expected outcome: assistant text always reflects real runtime state.
- Refs: `OWASP-PROMPT-INJ` (untrusted content handling), `OPENAI-FUNCTIONS`.

### E1-U1 `src/server/features/ai/runtime/index.ts`
- Problem: runtime entry still retains precheck-first hard-stop posture.
- Approach: route into attempt loop; keep precheck only for hard missing context.
- Why: availability-first behavior for real-world phrasing variance.
- Expected outcome: fewer false negatives ("can't build plan").
- Refs: OpenClaw attempt model.

### E1-U2 `src/server/features/ai/runtime/loop.ts`
- Problem: current loop assumes planner output as primary artifact.
- Approach: convert loop into attempt-runner orchestration or deprecate it.
- Why: avoid dual orchestration semantics.
- Expected outcome: one loop contract, one set of telemetry semantics.
- Refs: OpenClaw attempt flow.

### E1-U3 `src/server/features/ai/message-processor.ts`
- Problem: processor still carries old orchestration assumptions.
- Approach: make it a pure adapter into runtime entrypoint.
- Why: channel-facing code should not own orchestration decisions.
- Expected outcome: same execution behavior across web/slack/surfaces.
- Refs: `OPENAI-FUNCTIONS`.

### E1-U4 `src/server/features/channels/executor.ts`
- Problem: duplicate execution concerns in channel layer.
- Approach: keep only conversation/account resolution and invoke runtime.
- Why: preserves single-source runtime behavior.
- Expected outcome: less channel-specific drift.

### E1-D1 `src/server/features/ai/runtime/attempt.ts`
- Problem: overlapping attempt implementations create accidental forks.
- Approach: delete once `attempt-loop.ts` is active.
- Why: prevent future regressions by dead-path resurrection.
- Expected outcome: singular attempt implementation.

### E1-D2 `src/server/features/ai/runtime/response.ts`
- Problem: legacy response shaping may leak planner-era assumptions.
- Approach: remove after `finalize.ts` parity.
- Why: enforce one response contract.
- Expected outcome: consistent final message behavior.

## 12.4 Epic 2 Atomic Specs
### E2-C1 `src/server/features/ai/tools/contracts/tool-contract.ts`
- Problem: capability enum constrains open-world extensibility.
- Approach: define runtime-native tool contract (`name`, `schema`, `execute`, `metadata`).
- Why: tool-name based composition scales better than enum lock-in.
- Expected outcome: new tools can be added without capability-enum surgery.
- Refs: `OPENAI-FUNCTIONS`, `ANTHROPIC-TOOLS`, `AI-SDK`.

### E2-C2 `src/server/features/ai/tools/contracts/tool-result.ts`
- Problem: inconsistent result envelopes complicate synthesis and retries.
- Approach: standardize success/partial/failure envelope with machine fields.
- Why: deterministic post-processing and telemetry.
- Expected outcome: stable response synthesis and retry logic.

### E2-C3 `src/server/features/ai/tools/registry/index.ts`
- Problem: runtime tool lookup is currently indirect and capability-coupled.
- Approach: central `Map<string, ToolContract>` with startup validation.
- Why: O(1) lookup and deterministic collisions.
- Expected outcome: robust execution path and cleaner errors.

### E2-U1 `src/server/features/ai/tools/fabric/types.ts`
- Problem: `capabilityId` type dependency preserves closed model.
- Approach: switch to `toolName`/`ToolContract`.
- Why: breaks enum dependency chain.
- Expected outcome: all fabric users become runtime-tool-native.

### E2-U2 `src/server/features/ai/tools/fabric/assembler.ts`
- Problem: assembler delegates into switch-based capability executor.
- Approach: execute directly through tool registry contract.
- Why: tool-owned execution code is simpler and more extensible.
- Expected outcome: remove central switch bottleneck.

### E2-U3 `src/server/features/ai/policy/enforcement.ts`
- Problem: enforcement currently depends on capability definitions.
- Approach: enforce policy using tool metadata and action semantics.
- Why: enforcement must survive tool-set expansion.
- Expected outcome: rule-plane works with any dynamically loaded tool.

### E2-U4 `src/server/features/approvals/execute.ts`
- Problem: `capability_execute` branch ties approvals to removed stack.
- Approach: replace with `tool_execute` payload and tool registry re-execution.
- Why: approval replay must match runtime architecture.
- Expected outcome: approvals execute with same path as live calls.

### E2-D1 `src/server/features/ai/contracts/capability-contract.ts`
- Problem: global enum forces closed-catalog assumptions.
- Approach: delete once no imports remain.
- Why: prevent accidental enum reintroduction.
- Expected outcome: compile-time proof closed stack is gone.

### E2-D2 `src/server/features/ai/runtime/capability-executor.ts`
- Problem: giant switch is the core non-open-world bottleneck.
- Approach: delete after tool-contract migration.
- Why: tool ownership and dynamic loading become canonical.
- Expected outcome: no central switch.

### E2-D3 `src/server/features/ai/capabilities/*`
- Problem: capability modules carry closed-family constraints.
- Approach: remove and migrate logic into tool packs.
- Why: align with runtime-first tool model.
- Expected outcome: cleaner domain-to-tool mapping.

## 12.5 Epic 3 Atomic Specs
### E3-C1 `src/server/features/ai/tools/plugins/types.ts`
- Problem: no typed plugin surface for dynamic tools.
- Approach: define plugin manifest/tool factory types with version and collision policy fields.
- Why: formal interfaces prevent ad-hoc plugin drift.
- Expected outcome: safe plugin onboarding path.
- Refs: `MCP-SPEC` (modular capability negotiation principles).

### E3-C2 `src/server/features/ai/tools/plugins/loader.ts`
- Problem: tools are statically assembled from local registry only.
- Approach: load packs/plugins from repo-local manifests at startup.
- Why: runtime capability expansion without planner rewrites.
- Expected outcome: enabling a pack exposes tools immediately.

### E3-C3 `src/server/features/ai/tools/plugins/registry.ts`
- Problem: no canonical place to resolve plugin conflicts.
- Approach: merge, dedupe, and register with deterministic conflict resolution.
- Why: avoid non-deterministic tool selection.
- Expected outcome: startup error on unresolved conflict.

### E3-C4 `src/server/features/ai/tools/plugins/policy.ts`
- Problem: policy filter logic lacks plugin group semantics.
- Approach: add group-level allow/deny expansion and plugin-scoped controls.
- Why: enterprise-grade policy at scale needs grouping.
- Expected outcome: precise runtime tool exposure controls.

### E3-U1 `src/server/features/ai/tools/packs/manifest-schema.ts`
- Problem: manifest still references `capabilities` enum.
- Approach: move to explicit `tools` declarations with schema validation.
- Why: remove closed-contract coupling and improve readability.
- Expected outcome: manifest matches real runtime objects.
- Refs: `GEMINI-STRUCTURED`, `OPENAI-STRUCTURED`.

### E3-U2 `src/server/features/ai/tools/packs/loader.ts`
- Problem: loader currently translates enum -> tool name.
- Approach: load concrete tool declarations and runtime factories.
- Why: eliminate translation layer and enum dependency.
- Expected outcome: cleaner pack activation logic.

### E3-U3 `src/server/features/ai/tools/packs/registry.ts`
- Problem: hardcoded single pack blocks scalability.
- Approach: manifest-driven pack discovery.
- Why: faster capability growth and simpler maintenance.
- Expected outcome: multiple packs, dynamic enablement.

### E3-U4 `src/server/features/ai/tools/fabric/registry.ts`
- Problem: registry only reflects static pack output.
- Approach: registry composes plugin+pack+core tools with conflict checks.
- Why: OpenClaw-like dynamic assembly.
- Expected outcome: runtime tool set matches policy and deployment config.

### E3-U5 `src/server/features/ai/tools/fabric/policy-filter.ts`
- Problem: filter heuristics are currently shallow.
- Approach: add policy precedence order and explicit group handling.
- Why: deterministic controls prevent accidental overexposure.
- Expected outcome: auditable tool availability decisions.

### E3-D1 Remove `listCapabilityDefinitions()` dependency
- Problem: any remaining dependency keeps closed-catalog semantics.
- Approach: enforce no import rule and remove callsites.
- Why: strict architectural boundary.
- Expected outcome: capability registry is fully retired.

## 12.6 Epic 4 Atomic Specs
### E4-C1 `src/server/features/ai/skills/workspace.ts`
- Problem: skills are loaded from one static path only.
- Approach: discover workspace skill roots and parse frontmatter.
- Why: workspace-local specialization without code deploy.
- Expected outcome: per-workspace skill composition.

### E4-C2 `src/server/features/ai/skills/managed.ts`
- Problem: no internal managed skill distribution layer.
- Approach: managed skill source for controlled enterprise defaults.
- Why: operationally safer than ad-hoc copy/paste.
- Expected outcome: consistent internal skills across tenants.

### E4-C3 `src/server/features/ai/skills/bundled.ts`
- Problem: no explicit bundled baseline abstraction.
- Approach: define immutable bundled skill catalog.
- Why: ensures minimum capability hints always present.
- Expected outcome: stable baseline prompting.

### E4-C4 `src/server/features/ai/skills/composition.ts`
- Problem: precedence rules are implicit and fragile.
- Approach: explicit merge order workspace > managed > bundled.
- Why: deterministic override behavior.
- Expected outcome: predictable skill snapshots.

### E4-C5 `src/server/features/ai/skills/prompt.ts`
- Problem: prompt formatting logic is mixed with selection logic.
- Approach: dedicated formatting and truncation module.
- Why: easier token-budget control.
- Expected outcome: stable, compact skill prompt sections.

### E4-U1 `src/server/features/ai/skills/loader.ts`
- Problem: loader hardcodes one directory and weak metadata handling.
- Approach: refactor to composition-based loaders with strict metadata validation.
- Why: robust skill lifecycle management.
- Expected outcome: lower malformed-skill runtime failures.

### E4-U2 `src/server/features/ai/skills/snapshot.ts`
- Problem: simplistic scoring can overfit keyword hits.
- Approach: preserve lightweight scoring but decouple from execution gating.
- Why: skills should hint, not block.
- Expected outcome: graceful behavior even with imperfect skill selection.

### E4-U3 `src/server/features/ai/runtime/session.ts`
- Problem: session bootstrap binds to old loader assumptions.
- Approach: integrate composed skill snapshot here only.
- Why: single point of prompt context assembly.
- Expected outcome: consistent skills across all channels.

### E4-M1 Move skill markdown to canonical internal catalog
- Problem: fragmented skill placement causes drift.
- Approach: keep all skill markdown repo-local in canonical structure.
- Why: security and maintainability.
- Expected outcome: no external skill dependency.

### E4-D1/D2/D3 Delete legacy skill dirs
- Problem: empty legacy dirs invite accidental resurrection.
- Approach: remove `router`, `executor`, `registry` directories.
- Why: enforce one skill architecture.
- Expected outcome: cleaner codebase and fewer false paths.

## 12.7 Epic 5 Atomic Specs
### E5-C1 `src/server/features/ai/runtime/decision/schema.ts`
- Problem: planner schemas are capability-centric and brittle.
- Approach: define tool-call decision schema compatible with provider constraints.
- Why: reduce structured-output failures.
- Expected outcome: high-validity decision payloads.
- Refs: `GEMINI-STRUCTURED`, `OPENAI-STRUCTURED`.

### E5-C2 `src/server/features/ai/runtime/decision/generate.ts`
- Problem: plan generation is monolithic and slow.
- Approach: generate one next action decision per attempt loop turn.
- Why: incremental tool-first control.
- Expected outcome: lower latency and fewer all-or-nothing failures.

### E5-C3 `src/server/features/ai/runtime/decision/validate.ts`
- Problem: args validation is currently tied to planner step model.
- Approach: validate decision args against selected tool schema directly.
- Why: tool contract is runtime source-of-truth.
- Expected outcome: fewer invalid tool calls.

### E5-C4 `src/server/features/ai/runtime/decision/repair.ts`
- Problem: malformed args currently cause hard failures or degraded fallbacks.
- Approach: one bounded repair pass with explicit error context.
- Why: improve success rate without infinite retry loops.
- Expected outcome: resilient but bounded correction behavior.

### E5-U1/U2/U3/U4 planner file updates
- Problem: old planner types and builders preserve closed-catalog assumptions.
- Approach: replace with wrapper or deprecate behind decision engine.
- Why: migration continuity during cutover.
- Expected outcome: no runtime dependency on legacy planner semantics.

### E5-D1/D2 planner deletions
- Problem: keeping old planner code increases accidental reintroduction risk.
- Approach: delete obsolete planner entrypoints after migration.
- Why: clean architecture enforcement.
- Expected outcome: single decision path.

## 12.8 Epic 6 Atomic Specs
### E6-C1/C2 Inbox pack manifest + tools
- Problem: inbox operations are bundled in large provider wrappers.
- Approach: split into granular tools for search/read/mutate/compose/control.
- Why: better tool routing, observability, and approvals.
- Expected outcome: broad inbox action coverage with composability.
- Refs: `OPENAI-FUNCTIONS`, `ANTHROPIC-TOOLS`.

### E6-C3/C4 Calendar pack manifest + tools
- Problem: calendar actions are not exposed with enough granular control.
- Approach: split into event read/mutate/scheduling/availability primitives.
- Why: supports complex planning and mutation chains.
- Expected outcome: reliable calendar execution surface.
- Refs: `CAL-QUOTA`.

### E6-C5 `tools/common/throttle.ts`
- Problem: provider rate-limit behavior is not centrally enforced.
- Approach: per-user/provider token bucket or semaphore gating.
- Why: protect against 429 bursts.
- Expected outcome: reduced request spikes and retries.

### E6-C6 `tools/common/backoff.ts`
- Problem: retry timing is inconsistent across code paths.
- Approach: standard exponential backoff with jitter.
- Why: recommended by Google APIs and industry practice.
- Expected outcome: better recovery under transient limits.
- Refs: `GMAIL-ERRORS`, `CAL-QUOTA`.

### E6-U1 `tools/providers/email.ts`
- Problem: monolith hides operation-level semantics and throttling controls.
- Approach: refactor into thin provider adapter + granular tool modules.
- Why: runtime clarity and maintainability.
- Expected outcome: lower coupling and easier debugging.

### E6-U2 `tools/providers/calendar.ts`
- Problem: same monolith issue for calendar.
- Approach: same split strategy as email.
- Why: symmetry and consistency.
- Expected outcome: predictable behavior across domains.

### E6-U3 `src/server/integrations/google/message.ts`
- Problem: recursive retries + chunking can still trigger concurrency bursts.
- Approach: bounded queue worker strategy with explicit concurrency and batch sizing.
- Why: Gmail has explicit concurrent request limits.
- Expected outcome: less 429-induced latency and missing-message tails.
- Refs: `GMAIL-ERRORS`, `GMAIL-BATCH`.

### E6-U4 `tools/common/retry.ts`
- Problem: retry policy spread across modules leads to inconsistency.
- Approach: centralize retry classifier and retry budget.
- Why: stable behavior and easier tuning.
- Expected outcome: predictable failure semantics.

### E6-D1 Remove wrappers bypassing common retry/throttle
- Problem: bypass paths undermine reliability controls.
- Approach: delete or reroute all bypass callsites.
- Why: consistency under load.
- Expected outcome: one reliability envelope.

## 12.9 Epic 7 Atomic Specs
### E7-C1 `policy-plane/projections/preferences-projection.ts`
- Problem: preference reads may become expensive if always computed.
- Approach: optional projection cache from canonical rules.
- Why: performance without changing source-of-truth.
- Expected outcome: fast reads with canonical write authority.

### E7-C2 `policy-plane/projections/automation-projection.ts`
- Problem: automation trigger evaluation may be costly at scale.
- Approach: optional precompiled projection for trigger matching.
- Why: lower runtime cost while preserving canonical model.
- Expected outcome: faster automation dispatch.

### E7-U1 `ai/policy/enforcement.ts`
- Problem: enforcement branch still has assumptions tied to capability metadata.
- Approach: enforce against tool metadata and canonical policy decisions only.
- Why: architecture compatibility with dynamic tools.
- Expected outcome: no policy gaps on new tools.

### E7-U2 `features/policies/service.ts`
- Problem: policy facade may drift from canonical rule plane.
- Approach: keep as read facade over canonical services only.
- Why: API compatibility while reducing divergence.
- Expected outcome: one policy truth.

### E7-U3/U4 `api/rules/*` compatibility shim
- Problem: duplicate APIs cause write/read divergence.
- Approach: make `/api/rules` delegate to `/api/rule-plane`.
- Why: backward compatibility during migration.
- Expected outcome: single write path despite old endpoints.

### E7-U5/U6 `api/rule-plane/*`
- Problem: canonical endpoints need to become complete and final.
- Approach: ensure full CRUD/compile/disable semantics here.
- Why: final API target for clients.
- Expected outcome: one authoritative rule API.

### E7-U7 `policy-plane/learning-patterns.ts`
- Problem: still uses `prisma.rule`.
- Approach: port to canonical rule repository/service.
- Why: eliminate legacy model dependence.
- Expected outcome: learning updates on canonical rules only.

### E7-U8 `features/preferences/service.ts`
- Problem: digest/newsletter preference path still mutates legacy `Rule`.
- Approach: map these to canonical rule or projection updates.
- Why: consistency and drift elimination.
- Expected outcome: no preference logic on legacy rule table.

### E7-U9 `features/reply-tracker/*`
- Problem: reply tracker reads legacy rule state.
- Approach: replace with canonical rule queries.
- Why: coherent rule behavior for follow-up/tracking.
- Expected outcome: reply-tracker aligned with policy plane.

### E7-U10 `api/google/webhook/process-label-removed-event.ts`
- Problem: webhook logic still queries legacy rules.
- Approach: use canonical rule-plane lookup.
- Why: webhook automations must obey same rule system.
- Expected outcome: no split logic between webhook and runtime.

### E7-D1 Remove all direct `prisma.rule` access
- Problem: any remaining callsite reintroduces divergence.
- Approach: enforce via grep gate in migration checklist.
- Why: hard architectural boundary.
- Expected outcome: complete legacy rule path removal.

## 12.10 Epic 8 Atomic Specs
### E8-B1 Add migration for missing `TaskPreference` columns
- Problem: code references fields that may not exist in DB.
- Approach: explicit migration adding columns/indexes.
- Why: prevent runtime column-not-found failures.
- Expected outcome: schema and code alignment.
- Refs: `PRISMA-PROD`.

### E8-B2 Add `PendingAgentTurnState`
- Problem: split pending models duplicate logic and states.
- Approach: unified pending-turn model for clarification/approval resume.
- Why: simpler resume semantics and less state drift.
- Expected outcome: one pending state authority.

### E8-B3 Backfill legacy policy data into canonical tables
- Problem: historical rules/policies are stranded in legacy models.
- Approach: one-time deterministic backfill with `legacyRef*` mapping.
- Why: preserve behavior while removing old tables.
- Expected outcome: canonical model contains all active policy intent.

### E8-B4 Switch reads/writes to canonical only
- Problem: dual-write/dual-read causes non-deterministic behavior.
- Approach: code cutover after backfill validation.
- Why: enforce source-of-truth architecture.
- Expected outcome: no runtime dependence on legacy tables.

### E8-B5 Drop legacy tables
- Problem: keeping them invites accidental usage and schema drift.
- Approach: drop after cutover checkpoint.
- Why: architectural cleanliness.
- Expected outcome: simplified schema and reduced maintenance.

### E8-A1 `model PendingAgentTurnState` in `prisma/schema.prisma`
- Problem: pending state fragmentation.
- Approach: introduce unified model with typed payload and expiry indexes.
- Why: deterministic continuation logic.
- Expected outcome: simpler runtime resume code.

### E8-K1 Keep canonical authority models
- Problem: accidental redesign could break policy auditability.
- Approach: preserve `CanonicalRule*` and `Policy*Log` as core.
- Why: they are the future policy spine.
- Expected outcome: strong audit and governance model.

### E8-D1..D6 Drop legacy models (`Rule`, `RuleHistory`, `ApprovalPreference`, `CalendarEventPolicy`, `PendingSkillRunState`, `PendingPlannerRunState`)
- Problem: these models encode deprecated architecture.
- Approach: remove after migration/backfill and code cutover.
- Why: eliminate drift and dual semantics.
- Expected outcome: clean data model aligned to runtime.

### E8-U1 `prisma/schema.prisma` refresh
- Problem: schema currently reflects both old and new worlds.
- Approach: rewrite to canonical-only plus projection tables as needed.
- Why: long-term maintainability.
- Expected outcome: readable, stable schema.

### E8-U2 new migration folder
- Problem: untracked manual DB changes cause drift.
- Approach: migration-only production changes via `migrate deploy`.
- Why: reproducible infra.
- Expected outcome: safe CI/CD deployment.
- Refs: `PRISMA-PROD`.

## 12.11 Epic 9 Atomic Specs
### E9-C1 `runtime/response-contract.ts`
- Problem: inconsistent outbound payloads across channels.
- Approach: define canonical response contract for text, tool traces, approvals, partials.
- Why: channel adapters should be dumb renderers.
- Expected outcome: no channel-specific logic forks.

### E9-C2 `runtime/result-summarizer.ts`
- Problem: tool outputs are inconsistently summarized for users.
- Approach: deterministic summarizer for list/item/error/partial outcomes.
- Why: faster and clearer responses.
- Expected outcome: higher perceived reliability.

### E9-U1 `api/chat/route.ts`
- Problem: chat route uses assumptions from older execution model.
- Approach: align to runtime contract and strict validation.
- Why: prevent route-level divergence.
- Expected outcome: web behavior matches surfaces behavior.

### E9-U2 `features/channels/router.ts`
- Problem: router may over-own result formatting and action rendering.
- Approach: consume response contract directly.
- Why: reduce message-channel divergence.
- Expected outcome: consistent user-facing behavior.

### E9-U3 `runtime/telemetry/schema.ts`
- Problem: telemetry lacks enough fields to diagnose latency/failures.
- Approach: add step-level duration, retry count, provider limits, partial-success reasons.
- Why: operational readiness.
- Expected outcome: clear SLO/SLA diagnostics.

### E9-U4 `runtime/telemetry/unsupported-intents.ts`
- Problem: unsupported user intents are not systematically captured.
- Approach: normalize and emit unsupported intent signatures.
- Why: prioritize tool-capability growth by evidence.
- Expected outcome: roadmap driven by production demand.

### E9-D1 remove planner-specific response shaping
- Problem: planner-centric render code creates stale messaging.
- Approach: delete legacy shaping after contract migration.
- Why: eliminate dead assumptions.
- Expected outcome: cleaner response pipeline.

## 12.12 Epic 10 Atomic Specs
### E10-DIR1..DIR7 Delete legacy directories
- Problem: dead directories create ambiguity and accidental imports.
- Approach: delete:
  - `ai/orchestration`
  - `ai/planner`
  - `ai/provider-schemas`
  - `ai/capabilities`
  - `ai/skills/router`
  - `ai/skills/executor`
  - `ai/skills/registry`
- Why: enforce one architecture.
- Expected outcome: reduced cognitive load and no fallback regressions.

### E10-F1 `ai/contracts/capability-contract.ts` delete
- Problem: enum contract reintroduces closed model.
- Approach: remove after zero imports.
- Expected outcome: no enum path remains.

### E10-F2 `ai/runtime/capability-executor.ts` delete
- Problem: central switch is anti-open-world.
- Approach: remove after tool-contract migration.
- Expected outcome: tool-owned execution only.

### E10-F3/F4 `tools/packs/registry.ts` and `tools/packs/loader.ts` legacy versions delete/refactor
- Problem: still capability-coupled.
- Approach: keep only plugin/pack runtime-native versions.
- Expected outcome: true dynamic tool fabric.

### E10-F5 `policy-plane/learning-patterns.ts` legacy rewrite completion
- Problem: lingering legacy model behavior.
- Approach: ensure canonical-only reads/writes.
- Expected outcome: no legacy policy access.

### E10-F6 `calendar/safety-gate.ts` and `calendar/adaptive-replanner.ts`
- Problem: direct `CalendarEventPolicy` coupling.
- Approach: migrate to canonical policy reads, then remove old coupling logic.
- Expected outcome: calendar safeguards are rule-plane-driven.

### E10-API1 Keep only `/api/rule-plane*`
- Problem: API duplication risks semantic mismatch.
- Approach: remove `/api/rules*` after shim deprecation window.
- Expected outcome: single policy API surface.

### E10-DOC1 Replace stale plan docs
- Problem: multiple contradictory migration docs slow implementation and cause mistakes.
- Approach: designate this file as canonical and archive old ones.
- Expected outcome: one executable plan.

## 12.13 System-Level NFR Targets (Mandatory)
- P95 first-response latency for read-only inbox/calendar requests: target <= 3.5s (excluding upstream provider saturation windows).
- Mutation success correctness: no success response unless provider confirmed.
- Policy enforcement coverage: 100% of mutating tool calls pass through rule-plane decision hook.
- Schema safety: 0 provider schema rejection errors caused by local invalid schema generation.
- Legacy drift: 0 direct `prisma.rule` calls in runtime code after Epic 7.

## 12.14 Fresh Agent Operating Procedure
For any fresh agent implementing this plan:
1. Start each session by reading:
   - this plan
   - OpenClaw anchor files listed above
   - current runtime entry files
2. Execute epics in strict order from Section 11.4.
3. Before closing each epic, run drift grep:
   - `rg "CapabilityName|capabilityNameSchema|executeRuntimeCapability|prisma\\.rule" src prisma`
4. Do not mark epic complete until all bullet rows in that epic section are complete.
5. If one row is blocked, keep epic status as in-progress and document blocker with file path.

## 13. PRD Appendix For Non-Epic Sections (Bullet-Level)
This appendix removes ambiguity from Sections 2, 3, 5, 7, 8, 9, 10, and 11 by defining each bullet in the same PRD structure: problem, approach/why, expected outcome, references.

## 13.1 Section 2 Hard Constraints (Non-Negotiable)
### H1 Closed capability enum routing is removed
- Problem: enum-gated routing cannot scale to open-world request permutations and encourages brittle planner behavior.
- Approach: remove enum from runtime path and execute by dynamic `tool.name` contracts only.
- Why: OpenClaw-grade flexibility requires runtime tool binding, not compile-time intent classes.
- Expected outcome: requests are not rejected because they fail enum classification.
- Refs: `OPENAI-FUNCTIONS`, `ANTHROPIC-TOOLS`.

### H2 Runtime is tool-first and dynamic; tools are assembled per request
- Problem: static tool availability causes unnecessary refusals and poor adaptability.
- Approach: compose toolset at turn-time from provider context, account state, and policy overlays.
- Why: this is required for broad natural-language variability and contextual adaptation.
- Expected outcome: higher completion rate for messy user phrasing.
- Refs: OpenClaw `pi-tools.ts`, `AI-SDK`.

### H3 Skills are Markdown capability hints only (not hard routing)
- Problem: hard-routing by skill metadata creates hidden brittle gates.
- Approach: skills only influence prompting/context; runtime execution remains tool-contract driven.
- Why: prompt hints should bias choices, not block capability.
- Expected outcome: skill quality improves guidance without introducing hard failures.

### H4 Rule plane is only authority for allow/deny/approval/automation/preference behavior
- Problem: duplicated policy logic across services causes inconsistent behavior and trust failure.
- Approach: all mutating calls pass centralized rule-plane decision API.
- Why: single authority is mandatory for enterprise-grade explainability and auditability.
- Expected outcome: deterministic permission behavior across channels and tools.

### H5 Database schema is cleaned to eliminate source-of-truth drift
- Problem: dual models and partial migrations cause runtime and deploy-time breakage.
- Approach: canonical tables only, migration-first rollout, then hard deletion of legacy tables.
- Why: mixed data truth cannot be stabilized at scale.
- Expected outcome: predictable deploy behavior and no column/model drift incidents.
- Refs: `PRISMA-PROD`.

### H6 No dashboards in scope
- Problem: UX/dashboard work can consume time without fixing runtime reliability.
- Approach: exclude dashboard work from this migration plan.
- Why: user priority is core agent capability and operational readiness.
- Expected outcome: all effort focused on runtime, tools, and rule-plane correctness.

### H7 No tests in scope
- Problem: adding broad new tests now would delay critical architecture replacement.
- Approach: implement deterministic runtime and schema guardrails in code/docs first.
- Why: immediate objective is functional architecture cutover.
- Expected outcome: faster migration completion with lower architectural churn.

## 13.2 Section 3 Baseline Reference (OpenClaw patterns)
### B1 Runtime attempt loop
- Problem: current team lacks shared concrete reference for “what good looks like”.
- Approach: anchor on OpenClaw attempt loop semantics: bounded retries, tool execution as primary action, deterministic stop reasons.
- Why: this is the core behavior behind OpenClaw’s broad request handling.
- Expected outcome: migration decisions remain consistent with proven runtime behavior.
- Refs: OpenClaw `attempt.ts`.

### B2 Dynamic tool assembly + policy filtering
- Problem: static registry + hardcoded routing prevents contextual tool selection.
- Approach: mirror OpenClaw’s runtime assembly and policy filtering primitives.
- Why: context-aware tool exposure is required for open-world requests.
- Expected outcome: tool availability adapts to user, provider, and policy context.
- Refs: OpenClaw `pi-tools.ts`, `tool-policy.ts`, `plugins/tools.ts`.

### B3 Workspace + bundled + managed skill composition
- Problem: flat or single-root skills do not scale for enterprise customizations.
- Approach: implement ordered composition model with clear precedence.
- Why: it supports tenant customization without runtime rewrites.
- Expected outcome: skills remain maintainable while preserving deterministic precedence.
- Refs: OpenClaw `skills/workspace.ts`.

## 13.3 Section 5 Target Architecture (End State)
### Runtime Flow Step 1: inbound request enters one runtime entrypoint
- Problem: multiple execution entrypoints create behavioral drift.
- Approach: enforce single ingress function for all channels.
- Why: one runtime path is prerequisite for reliability.
- Expected outcome: identical behavior across Slack/web/API surfaces.

### Runtime Flow Step 2: runtime builds context + dynamic tool set
- Problem: missing context and static tool lists cause avoidable failures.
- Approach: hydrate account/provider/policy context before model decision.
- Why: model can only choose good actions with accurate, constrained options.
- Expected outcome: better tool selection and fewer invalid calls.

### Runtime Flow Step 3: LLM chooses/executes tools in short attempt loop
- Problem: monolithic planning increases latency and hard-fail risk.
- Approach: one-step decision + execute loop, bounded by max attempts.
- Why: incremental execution recovers better from ambiguity.
- Expected outcome: faster, more resilient completion.

### Runtime Flow Step 4: each mutating call is pre-enforced by rule plane
- Problem: post-hoc policy checks can leak unauthorized actions.
- Approach: block/approve before execute with deterministic policy records.
- Why: trust and compliance require pre-execution controls.
- Expected outcome: no mutation bypasses policy.

### Runtime Flow Step 5: results synthesized into direct response
- Problem: planner-artifact responses misreport what happened.
- Approach: summarize only concrete tool outcomes.
- Why: prevents false positives and user confusion.
- Expected outcome: truthful responses with execution traces.

### Runtime Flow Step 6: unified pending state for clarification/approval
- Problem: split pending models create dead-ends and resume bugs.
- Approach: single pending-turn model with explicit continuation semantics.
- Why: simplifies state machine and reduces stuck sessions.
- Expected outcome: reliable resume after user follow-up/approval.

### Tooling Model bullets
- Problem: capability IDs and static registration are non-scalable.
- Approach: `tool.name` identity + dynamic registration + conflict policy + overlay filters.
- Why: this mirrors proven open-world runtime behavior.
- Expected outcome: tools can evolve independently while keeping deterministic runtime assembly.

### Skills Model bullets
- Problem: skills can become accidental hard constraints.
- Approach: local-only markdown hints with strict composition precedence and no blocking.
- Why: maximize flexibility without sacrificing internal control.
- Expected outcome: skills improve model behavior without limiting execution.

### Rule Plane Model bullets
- Problem: mixed legacy/canonical policy paths break trust.
- Approach: canonical-only decisions, legacy relegated to projection/backfill, full decision logging.
- Why: policy must be explainable and enforceable.
- Expected outcome: enterprise-ready policy audit trail and deterministic behavior.

## 13.4 Section 7 Schema-Mismatch Prevention Rules
### Guardrail: provider-compatible schemas only
- Problem: current failures show provider rejects invalid schema constructs.
- Approach: enforce provider-safe schema subset and fail build on unsupported constructs.
- Why: schema rejection currently causes catastrophic runtime degradation.
- Expected outcome: zero known invalid schema submissions.
- Refs: `GEMINI-STRUCTURED`, `OPENAI-STRUCTURED`.

### Guardrail: migration-before-runtime changes
- Problem: code can reference columns not yet deployed.
- Approach: require migration merge + deploy before feature paths use new fields.
- Why: eliminates column-not-found production incidents.
- Expected outcome: no code/schema race conditions.
- Refs: `PRISMA-PROD`.

### Guardrail: single source for policy checks
- Problem: duplicate policy checks cause contradictions.
- Approach: runtime uses one rule-plane enforcement function only.
- Why: deterministic policy behavior is mandatory.
- Expected outcome: no divergent permission outcomes for same request.

## 13.5 Section 8 Cutover Sequence
### Phase gating
- Problem: big-bang cutover without sequence causes prolonged outages.
- Approach: follow strict order: runtime core -> tool contracts -> plugins -> skills -> planner removal -> native packs -> rule-plane authority -> db cleanup -> channel cleanup -> legacy delete.
- Why: each phase removes a dependency for the next.
- Expected outcome: controlled migration with minimal regressions.

### Rollback posture
- Problem: undocumented rollback paths increase incident time.
- Approach: at each phase boundary, keep one known-good deploy tag and reversible migration checkpoints until schema drop phase.
- Why: operational readiness requires practical rollback windows.
- Expected outcome: faster recovery if a phase fails in production.

## 13.6 Section 9 Expected Product Behavior After Completion
### Behavior: basic inbox/calendar reads succeed without plan-build dead-ends
- Problem: users currently hit “can’t build execution plan” for simple asks.
- Approach: attempt-loop executes direct read tools with bounded retries.
- Why: reads should be easiest path and must be robust.
- Expected outcome: “what is my first email” and similar asks complete quickly.

### Behavior: mutating actions always policy-gated
- Problem: trust breaks when mutation and approval semantics vary by route.
- Approach: pre-exec rule-plane checks + approval state transitions.
- Why: consistent governance is core product requirement.
- Expected outcome: predictable approvals/denials across all channels.

### Behavior: no planner-schema hard failures on turn start
- Problem: structured planner schemas currently break execution.
- Approach: remove planner-critical path; use tool decision schemas compatible with provider limits.
- Why: runtime availability should not depend on brittle planner models.
- Expected outcome: fewer immediate-turn failures and lower latency.

## 13.7 Section 10 Directory Coverage Matrix
### Coverage objective
- Problem: partial directory audits leave hidden legacy execution paths.
- Approach: explicit R/M/K/D classification for every top-level and critical subtree.
- Why: migration only succeeds if no active legacy path survives.
- Expected outcome: complete, auditable cleanup scope for fresh agents.

### Delete certainty
- Problem: uncertainty about deletions causes accidental preservation of dead architecture.
- Approach: each delete candidate requires explicit replacement path and final grep verification.
- Why: safe deletion needs deterministic dependency checks.
- Expected outcome: clean codebase with no orphan runtime code.

## 13.8 Section 11 Fresh Agent Handoff Context
### Mission clarity
- Problem: fresh agents lose time and quality without explicit mission/constraints.
- Approach: provide clear success definition, anti-goals, and mandatory sequence.
- Why: consistent execution quality across agents.
- Expected outcome: lower onboarding overhead and fewer architectural mistakes.

### Execution strictness
- Problem: skipping order can reintroduce drift.
- Approach: enforce strict epic order and per-epic done checks.
- Why: dependency chain is hard and non-optional.
- Expected outcome: stable convergence to target architecture.

### Drift checklist
- Problem: legacy symbols can quietly creep back in.
- Approach: mandatory grep checks for known anti-patterns every epic close.
- Why: objective verification beats subjective confidence.
- Expected outcome: measurable prevention of architecture regression.
