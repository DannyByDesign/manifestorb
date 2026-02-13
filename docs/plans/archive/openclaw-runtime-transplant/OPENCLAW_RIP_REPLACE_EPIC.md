# OpenClaw-Style Runtime Transplant (Rip-and-Replace Epic)

## Objective
Rebuild this product around an OpenClaw-style open-world agent runtime so the assistant can handle broad, messy user requests across inbox/calendar first, then expand to full capability breadth. This is a **clean cutover** plan: no legacy fallback runtime.

## Non-Negotiable Constraints
- **Rip and replace**: remove legacy closed-catalog routing/planner code once replacement is live.
- **Internal-only skills**: all `SKILL.md` capability hints must live in this repo under `skills/` (no third-party skill files).
- **Rule Plane is source of truth** for permissions, approvals, automations, and preferences.
- **Operational readiness over extra hardening** for first ship: prioritize correctness, latency, and ability to execute real-world requests.
- **Schema safety is mandatory**: prevent provider schema mismatches and invalid JSON-schema payloads.

## OpenClaw Patterns To Transplant
Read source basis:
- Runtime loop/session orchestration:
  - `/Users/dannywang/Projects/openclaw/src/agents/pi-embedded-runner/run/attempt.ts`
- Tool assembly and dynamic tool fabric:
  - `/Users/dannywang/Projects/openclaw/src/agents/pi-tools.ts`
  - `/Users/dannywang/Projects/openclaw/src/agents/openclaw-tools.ts`
  - `/Users/dannywang/Projects/openclaw/src/plugins/tools.ts`
- Skill loading and prompt injection:
  - `/Users/dannywang/Projects/openclaw/src/agents/skills/workspace.ts`
  - `/Users/dannywang/Projects/openclaw/src/agents/system-prompt.ts`
- Tool policy filtering:
  - `/Users/dannywang/Projects/openclaw/src/agents/pi-tools.policy.ts`
  - `/Users/dannywang/Projects/openclaw/src/agents/tool-policy.ts`

## Current Code Cut Points (amodel)
Primary replacement targets:
- `src/server/features/ai/message-processor.ts`
- `src/server/features/ai/orchestration/*`
- `src/server/features/ai/planner/*`
- `src/server/features/ai/capabilities/*`
- `src/server/features/ai/skills/router/*`
- `src/server/features/ai/skills/executor/*`
- `src/server/features/ai/skills/runtime.ts`
- `src/server/features/ai/system-prompt.ts`
- `src/server/features/ai/provider-schemas/*`

Rule-plane integration targets (keep and elevate):
- `src/server/features/policy-plane/pdp.ts`
- `src/server/features/policy-plane/service.ts`
- `src/server/features/policy-plane/repository.ts`
- `src/server/features/policy-plane/compiler.ts`
- `src/server/features/policy-plane/automation-executor.ts`

Legacy rule-system deprecation candidates (post-cutover):
- `src/server/features/rules/**`

---

## Epic 1: Runtime Kernel Replacement
### Goal
Replace the existing closed orchestration/preflight/router/planner entry flow with a single OpenClaw-style runtime kernel.

### Scope
- Create `src/server/features/ai/runtime/` with:
  - `session.ts` (load context, histories, user bindings)
  - `attempt.ts` (single attempt lifecycle)
  - `loop.ts` (stream/retry/repair loop)
  - `response.ts` (final user response shaping)
- Repoint `message-processor.ts` to runtime kernel.
- Remove preflight-gating as a hard blocker; retain only cheap deterministic prechecks.

### Remove/Replace
- Replace all imports from `ai/orchestration/preflight.ts` inside runtime path.
- Stop using legacy orchestration-first branching.

### Schema Safety Gates
- Every LLM call label has an explicit output contract file in `src/server/features/ai/contracts/`.
- No provider schema generated from transformed zod objects at runtime.

### Exit Criteria
- All inbound messages route through new kernel path.
- No user-facing "cannot build execution plan" from legacy preflight branch.

---

## Epic 2: Dynamic Tool Fabric (Open-World Tooling)
### Goal
Adopt OpenClaw-style dynamic tool assembly so execution is driven by available tools, not hardcoded capability families.

### Scope
- Create `src/server/features/ai/tools/fabric/`:
  - `registry.ts` (all tool definitions)
  - `assembler.ts` (session-specific tool set)
  - `policy-filter.ts` (rule-plane + environment filter)
  - `adapters/` (provider-safe tool schema adapters)
- Tool classes:
  - Native product tools (email/calendar/rule-plane/approvals)
  - Internal extension tools (future domain expansion)
- Add per-tool metadata:
  - `riskLevel`, `requiresApproval`, `idempotencyClass`, `domain`

### Remove/Replace
- De-emphasize capability-registry-first execution path.
- Planner should consume tool fabric, not static capability registry.

### Schema Safety Gates
- Tool arg/result schema stored as static JSON schema snapshots.
- Reject empty-object object schemas (no `properties: {}` for OBJECT constraints where provider forbids them).

### Exit Criteria
- Runtime can expose a variable tool set per request/session.
- Tool availability changes without changing planner code.

---

## Epic 3: Internal Skill MD System (Hints, Not Hard Routing)
### Goal
Convert skills to Markdown capability hints and remove skill routing as the core execution mechanism.

### Scope
- Standardize `skills/<skill-id>/SKILL.md` format:
  - intent examples
  - preferred tools
  - constraints
  - composition patterns
- Build skill loader:
  - `src/server/features/ai/skills/loader.ts`
  - `src/server/features/ai/skills/snapshot.ts`
- Inject selected skill snippets into system prompt context.
- Keep skills in-repo only; disable external skill import sources.

### Remove/Replace
- Remove dependence on `skills/router/route-skill.ts` for critical path decisions.
- Remove closed baseline skill registry as execution gate.

### Schema Safety Gates
- Skill metadata (YAML frontmatter or sidecar JSON) must validate against local schema.

### Exit Criteria
- Skills are capability guidance only; runtime still works if no matching skill exists.

---

## Epic 4: Open-World Planner/Executor Rebuild
### Goal
Replace closed capability planner with tool-first plan synthesis and execution.

### Scope
- Implement planner stack under `src/server/features/ai/runtime/planner/`:
  - `plan-draft.ts` (tool-first step proposal)
  - `plan-validate.ts` (arg schema + policy checks)
  - `plan-execute.ts` (step runner)
  - `plan-repair.ts` (repair from errors/tool feedback)
- Add direct-execution lane for simple requests (single-tool intent without full plan overhead).
- Add pending continuation state with deterministic resume semantics.

### Remove/Replace
- Replace `src/server/features/ai/planner/*` and capability-family selector logic.
- Remove long-tail fallback planner path that emits schema-invalid args objects.

### Schema Safety Gates
- Planner step args must reference concrete tool input schemas.
- No generic `args: object` with unconstrained properties.

### Exit Criteria
- Natural language requests map to tool plans without closed family matching.

---

## Epic 5: Rule Plane As Mandatory Policy Decision Point
### Goal
Integrate rule-plane enforcement at every mutating tool action while keeping open-world flexibility.

### Scope
- Add runtime policy hook before every tool call:
  - `allow`
  - `deny`
  - `require_approval`
  - `rewrite_constraints`
- Rule plane governs:
  - permissions
  - approval requirements
  - automation triggers
  - preference constraints
- Create single enforcement adapter:
  - `src/server/features/ai/policy/enforcement.ts` (calls policy-plane PDP)

### Remove/Replace
- Eliminate scattered permission checks inside legacy skills/planner branches.
- Deprecate duplicate policy paths outside rule-plane decisions.

### Schema Safety Gates
- Policy decision envelope is versioned and typed (`decisionVersion`, `reasonCodes`, `appliedRuleIds`).

### Exit Criteria
- Every mutating action produces a policy decision record.

---

## Epic 6: Inbox/Calendar Native Action Layer (High-Fidelity)
### Goal
Create robust domain primitives for inbox/calendar so tool plans can compose reliably for complex requests.

### Scope
- Build stable domain tool packs:
  - `tools/email/*` (search, fetch message, thread summarize, draft/send, label/move)
  - `tools/calendar/*` (search events, create/update/delete, scheduling negotiation)
- Add bulk operations with bounded concurrency and adaptive throttling.
- Normalize domain entities (`EmailRef`, `ThreadRef`, `CalendarEventRef`, `AttendeeRef`).

### Remove/Replace
- Remove fragmented provider wrappers that bypass common retry/throttle/idempotency layer.

### Schema Safety Gates
- Shared domain schema package used by all email/calendar tools.
- Tool outputs must include machine-readable references (IDs + source account).

### Exit Criteria
- Request classes like “first email”, “reschedule all Friday calls”, “reply to latest client thread” execute through composed primitives.

---

## Epic 7: Broad Capability Framework (Beyond Inbox/Calendar)
### Goal
Adopt OpenClaw-style extensibility so new capability domains can be added without planner rewrites.

### Scope
- Add internal plugin-like capability packs (repo-local only):
  - `src/server/features/ai/tools/packs/<pack-id>/`
- Register packs through tool fabric.
- Add capability manifest for each pack:
  - pack metadata
  - tool list
  - dependency flags

### Remove/Replace
- Remove monolithic capability registry dependence.

### Schema Safety Gates
- Manifest schema validation on server start.
- Tool name uniqueness checks across packs.

### Exit Criteria
- New domain pack can be dropped in and discovered by runtime automatically.

---

## Epic 8: Legacy Deletion And Codebase Simplification
### Goal
Delete replaceable legacy code to maintain a clean architecture.

### Scope
- Remove legacy modules after cutover:
  - `src/server/features/ai/capabilities/*`
  - `src/server/features/ai/planner/*` (legacy branch)
  - `src/server/features/ai/skills/router/*`
  - `src/server/features/ai/skills/executor/*` (legacy IR/compiler/repair)
  - `src/server/features/rules/**` (after rule-plane parity confirmation)
- Update imports across app/api surfaces.

### Schema Safety Gates
- Delete only after compile-time import graph confirms no live references.
- Migration checklist for each deleted folder with replacement path.

### Exit Criteria
- No dual runtime paths.
- No dead registry/router scaffolding.

---

## Epic 9: Operational Readiness, Latency, and Reliability
### Goal
Make runtime fast and stable enough for production workloads.

### Scope
- Add global execution controls:
  - per-user concurrency caps
  - Gmail/Calendar adaptive backoff + jitter
  - bounded retries by error class
- Add execution observability:
  - plan build latency
  - tool call latency/failure rate
  - policy decision distribution
  - resume loops and dead-ends
- Add automatic plan truncation + summarization for long chains.

### Remove/Replace
- Remove unbounded parallel provider fetches that trigger 429 floods.

### Schema Safety Gates
- Structured telemetry schema with strict enum/value validation.

### Exit Criteria
- Median and p95 response latency targets defined and met in staging.
- 429 behavior degrades gracefully with useful partial responses.

---

## Epic 10: Cutover And Competitive Parity Roadmap
### Goal
Cut over fully, then scale capability breadth to OpenClaw-level competitiveness.

### Scope
- Final switch to new runtime in production.
- Remove feature flags for legacy path.
- Launch wave plan:
  - Wave 1: Inbox + Calendar + Rule-plane + Automations
  - Wave 2: Additional internal tool packs
  - Wave 3: Enterprise controls and governance enhancements

### Remove/Replace
- Delete legacy feature toggles and compatibility shims.

### Schema Safety Gates
- Cutover checklist requires:
  - zero schema mismatch errors in dry run
  - zero unresolved contract labels
  - zero invalid provider response-schema rejections

### Exit Criteria
- Single runtime architecture in prod.
- Clear backlog for all-domain capability expansion.

---

## Schema Mismatch Prevention Checklist (Mandatory For Every Epic)
1. Contract-first: every LLM call has a checked contract module.
2. Provider compatibility test: generated schema validated against target provider constraints before deploy.
3. No dynamic zod transforms in response schema generation path.
4. Tool args/result schemas versioned and backward-incompatible changes blocked unless migration applied.
5. Startup validation fails hard on:
   - duplicate tool names
   - invalid enum types
   - empty object schema where unsupported
   - missing required properties

## Deletion Policy (Clean Codebase)
- If replacement path is complete and production-wired, delete legacy code in same epic.
- No long-term fallback branches.
- No “temporary” dual routers/planners past one release window.

## Deliverables
- This epic doc: `docs/plans/openclaw-runtime-transplant/OPENCLAW_RIP_REPLACE_EPIC.md`
- Follow-up execution board (ticketized by epic and package).
- Cutover checklist and module deletion checklist tied to each epic.

## Recommended Execution Order
1. Epic 1
2. Epic 2
3. Epic 3
4. Epic 4
5. Epic 5
6. Epic 6
7. Epic 7
8. Epic 8
9. Epic 9
10. Epic 10

## Expected End State
A single OpenClaw-style, tool-first, open-world runtime that can interpret highly variable natural-language requests, execute across inbox/calendar reliably, and scale to broad future capability domains, with rule-plane decisions as the authoritative guardrail layer.

---

## Low-Hanging Limitation Mitigations (Required)
These are mandatory mitigations for obvious failure classes. They are scoped for practical implementation and avoid deep edge-case over-engineering.

### 1) Missing tools for new actions
Problem:
- Users ask for actions that do not map to available tools.

Mitigations:
- Add a **capability gap detector** in planner output:
  - classify each user intent segment as `supported`, `partially_supported`, or `unsupported`.
- Add a **single fallback decomposition pass**:
  - attempt to decompose unsupported intents into available primitive tools.
- Add a **production backlog emitter**:
  - log unsupported intents with normalized pattern keys for weekly tool-pack expansion.

Phase mapping:
- Epic 2, Epic 4, Epic 7

Acceptance:
- Runtime returns partial execution plus explicit unsupported segments instead of hard failure.
- Top unsupported patterns are automatically visible in telemetry.

### 2) Ambiguous or conflicting user requests
Problem:
- User intent is unclear (“move that meeting”, “reply to him”) or conflicts with itself.

Mitigations:
- Add an **ambiguity resolver** before execution:
  - detect missing/ambiguous entities (person, thread, event, date/time).
- Add a **single-turn clarification policy**:
  - ask one concise question when confidence is below threshold.
- Add **safe deterministic defaults** for non-destructive reads:
  - latest thread/event, primary account, local timezone.

Phase mapping:
- Epic 4, Epic 6

Acceptance:
- Ambiguous requests either resolve in one clarification turn or execute with transparent defaults.

### 3) External API failures, rate limits, and account scope issues
Problem:
- Provider APIs fail (`429`, auth drift, transient outages), causing slow or wrong outcomes.

Mitigations:
- Centralize provider access through shared controls:
  - per-user concurrency caps
  - exponential backoff + jitter
  - retry budget by error class
- Add **progressive result delivery**:
  - return partial successful results while retries continue in bounded window.
- Add **auth/scope precheck**:
  - detect missing scopes/account bindings before plan execution.

Phase mapping:
- Epic 6, Epic 9

Acceptance:
- `429` no longer causes total response collapse for common read workflows.
- Missing auth/scope returns actionable remediation message immediately.

### 4) Context gaps (missing data needed to execute)
Problem:
- Planner lacks required context (calendar selection, account identity, thread reference, timezone).

Mitigations:
- Add a **pre-execution context hydration step**:
  - fetch minimal required entities for candidate tool steps.
- Add **context contracts** per tool:
  - required context keys must be present before step execution.
- Add **deterministic context failure messages**:
  - exact missing keys and next action for user.

Phase mapping:
- Epic 1, Epic 4, Epic 6

Acceptance:
- Execution failures due to missing context become explicit and actionable, not generic planner failure.

### 5) Model reasoning mistakes on ordinary long-tail requests
Problem:
- LLM occasionally produces invalid step ordering/args on realistic long-tail instructions.

Mitigations:
- Add **deterministic plan validator** before execution:
  - schema validity, tool existence, argument completeness, policy precheck.
- Add **single repair pass** with concrete validator error feedback.
- Add **max-step and timeout budgets** with graceful degradation response.

Phase mapping:
- Epic 4, Epic 9

Acceptance:
- Invalid initial plans are corrected automatically in one repair cycle for common cases.
- Runtime avoids long stalls and returns bounded-time outcomes.

## Go/No-Go Criteria For “Open-World Ready”
Before declaring runtime ready, all must be true:
1. Unsupported-intent telemetry exists and is reviewed weekly.
2. One-turn clarification flow is live for ambiguity.
3. Shared provider throttling/retry controls are active.
4. Context hydration and missing-context messaging are active.
5. Plan validator + one-pass repair is active.
