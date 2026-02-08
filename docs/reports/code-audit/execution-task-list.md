# Execution Task List (Code-Only Audit -> Implementation)

## Core Mission Target
- Deliver a trustworthy individual assistant for inbox + calendar with robust approvals/notifications.
- Coverage target: >= 190/220 full support.

## Completed in This Execution
- [x] Add runtime quarantine framework for non-core API surfaces.
  - Files: `src/lib/quarantine.ts`, `src/proxy.ts`
- [x] Add tool-level resource quarantine and per-tool resource validation.
  - File: `src/server/features/ai/tools/security.ts`
- [x] Tighten tool execution order (permission/scope checks before rate limiting).
  - File: `src/server/features/ai/tools/executor.ts`
- [x] Fix notification poll claim race filtering.
  - File: `src/app/api/notifications/poll/route.ts`
- [x] Fix fallback notification loss path (no permanent "pushed" mark on failed push).
  - File: `src/app/api/notifications/fallback/route.ts`
- [x] Expand channel push target set to include Telegram.
  - File: `src/server/features/channels/router.ts`
- [x] Replace approval conditional-recipient extraction with nested argument parsing.
  - File: `src/server/features/approvals/policy.ts`
- [x] Replace `get` automation stub with real lookup behavior.
  - File: `src/server/features/ai/tools/get.ts`
- [x] Remove unstable time-based idempotency keys in approval paths.
  - Files:
  - `src/server/features/ai/message-processor.ts`
  - `src/server/features/ai/tools/create.ts`
  - `src/server/features/calendar/scheduling/TaskSchedulingService.ts`
- [x] Remove LLM-generated approval/denial confirmations (deterministic status messaging only).
  - Files:
  - `src/app/api/approvals/[id]/approve/route.ts`
  - `src/app/api/approvals/[id]/deny/route.ts`
- [x] Add very-vague request clarification guard in message processor.
  - File: `src/server/features/ai/message-processor.ts`
- [x] Add conditional workflow step gating (`runIf`) for if/else style execution.
  - File: `src/server/features/ai/tools/workflow.ts`
- [x] Strengthen approval types and transaction typing.
  - Files:
  - `src/server/features/approvals/types.ts`
  - `src/server/features/approvals/service.ts`
- [x] Refresh taxonomy capability model to reflect implemented capabilities.
  - File: `src/server/features/ai/evals/taxonomy.ts`

## Completed Validation
- [x] Targeted tests for changed reliability paths:
  - `src/server/features/ai/tools/security.test.ts`
  - `src/server/features/ai/tools/executor-meta.test.ts`
  - `src/server/features/approvals/policy.test.ts`
  - `src/app/api/notifications/poll/route.test.ts`
  - `src/app/api/notifications/fallback/route.test.ts`
  - `src/server/features/ai/tools/workflow.test.ts`
  - `src/app/api/approvals/[id]/approve/route.test.ts`
  - `src/app/api/approvals/[id]/deny/route.test.ts`
- [x] Taxonomy CI gate:
  - command: `bun run eval:taxonomy:ci`
  - result: `full=215/220`, `partial=5`, `unsupported=0`

## Known Global Validation Constraint
- Full repo lint currently fails due large pre-existing baseline unrelated to this patch set (`no-explicit-any`, test legacy issues, etc.).
- This execution validated changed paths with targeted tests and taxonomy gate.

## Next Execution Batch (already queued by code map)
- [ ] Continue quarantining candidate non-core feature directories behind explicit flags.
- [ ] Add resource-specific retry/backoff wrappers for transient provider failures.
- [ ] Standardize tool result envelopes for all resources (strict shape parity).
- [ ] Add end-to-end approval-notification-chain tests for Slack/Discord/Telegram.
- [ ] Reintroduce quarantined modules only with contract tests + success metrics.
