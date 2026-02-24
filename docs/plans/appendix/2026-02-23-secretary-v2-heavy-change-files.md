# Secretary Runtime V2 Heavy-Change File List

- Source: `docs/plans/appendix/2026-02-23-secretary-v2-src-map.csv`
- Total heavy files: 277

## `MODIFY_V2_CORE` (53 files, 8488 lines)

| File | Line Span | Lines | Domain | Rationale |
|---|---|---:|---|---|
| `src/server/features/ai/actions.ts` | `1-1252` | 1252 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/authoritative-history.ts` | `1-28` | 28 | `ai_runtime` | Align docs/helpers with v2 contracts |
| `src/server/features/ai/conversational-copy.ts` | `1-79` | 79 | `ai_runtime` | Align docs/helpers with v2 contracts |
| `src/server/features/ai/cross-reference.ts` | `1-101` | 101 | `ai_runtime` | Align docs/helpers with v2 contracts |
| `src/server/features/ai/helpers.test.ts` | `1-333` | 333 | `ai_runtime` | Align docs/helpers with v2 contracts |
| `src/server/features/ai/helpers.ts` | `1-82` | 82 | `ai_runtime` | Align docs/helpers with v2 contracts |
| `src/server/features/ai/message-processor.test.ts` | `1-46` | 46 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/message-processor.ts` | `1-1042` | 1042 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/response-guards.ts` | `1-10` | 10 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/attempt-loop.history.test.ts` | `1-83` | 83 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/attempt-loop.ts` | `1-723` | 723 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/compiler-context.ts` | `1-69` | 69 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/concurrency.ts` | `1-43` | 43 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/context/hydrator.test.ts` | `1-198` | 198 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/context/hydrator.ts` | `1-177` | 177 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/context/memory-flush.ts` | `1-61` | 61 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/context/precheck.ts` | `1-23` | 23 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/context/pruning.test.ts` | `1-53` | 53 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/context/pruning.ts` | `1-227` | 227 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/context/render.ts` | `1-107` | 107 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/context/requirements.ts` | `1-28` | 28 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/context/retrieval-broker.ts` | `1-187` | 187 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/context/slot-budget.test.ts` | `1-14` | 14 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/context/slot-budget.ts` | `1-37` | 37 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/deadline-context.ts` | `1-44` | 44 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/deterministic-cross-surface.test.ts` | `1-239` | 239 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/finalize.ts` | `1-40` | 40 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/harness/session-runner.ts` | `1-52` | 52 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/harness/tool-events.test.ts` | `1-99` | 99 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/harness/tool-events.ts` | `1-69` | 69 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/index.ts` | `1-102` | 102 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/response-contract.ts` | `1-13` | 13 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/response-writer.ts` | `1-154` | 154 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/result-summarizer.test.ts` | `1-33` | 33 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/result-summarizer.ts` | `1-40` | 40 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/router.test.ts` | `1-142` | 142 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/router.ts` | `1-122` | 122 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/session.test.ts` | `1-56` | 56 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/session.ts` | `1-272` | 272 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/telemetry/schema.test.ts` | `1-54` | 54 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/telemetry/schema.ts` | `1-146` | 146 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/telemetry/unsupported-intents.ts` | `1-31` | 31 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/tool-runtime.test.ts` | `1-101` | 101 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/tool-runtime.ts` | `1-58` | 58 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/turn-compiler.test.ts` | `1-139` | 139 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/turn-compiler.ts` | `1-853` | 853 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/turn-contract.ts` | `1-220` | 220 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/runtime/types.ts` | `1-60` | 60 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/security.ts` | `1-28` | 28 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/step-budget.ts` | `1-74` | 74 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/system-prompt.ts` | `1-69` | 69 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/thread-context.ts` | `1-142` | 142 | `ai_runtime` | Primary runtime migration zone |
| `src/server/features/ai/types.ts` | `1-33` | 33 | `ai_runtime` | Primary runtime migration zone |

## `MODIFY_V2_TOOLING` (112 files, 17218 lines)

| File | Line Span | Lines | Domain | Rationale |
|---|---|---:|---|---|
| `src/server/features/ai/actions/register-defaults.ts` | `1-32` | 32 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/actions/registry.ts` | `1-60` | 60 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/contracts/provider-safe-value.ts` | `1-62` | 62 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/skills/bundled.ts` | `1-9` | 9 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/skills/catalog/inbox-calendar-agent/SKILL.md` | `1-18` | 18 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/skills/catalog/open-world-planning/SKILL.md` | `1-15` | 15 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/skills/catalog/rule-plane-agent/SKILL.md` | `1-14` | 14 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/skills/composition.ts` | `1-39` | 39 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/skills/loader.ts` | `1-15` | 15 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/skills/managed.ts` | `1-9` | 9 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/skills/prompt.ts` | `1-18` | 18 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/skills/snapshot.ts` | `1-44` | 44 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/skills/source-loader.ts` | `1-81` | 81 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/skills/types.ts` | `1-13` | 13 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/skills/workspace.ts` | `1-9` | 9 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/calendar-time.test.ts` | `1-81` | 81 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/calendar-time.ts` | `1-256` | 256 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/calendar/primitives.ts` | `1-83` | 83 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/common/backoff.ts` | `1-19` | 19 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/common/concurrency.ts` | `1-29` | 29 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/common/idempotency.ts` | `1-11` | 11 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/common/retry.ts` | `1-73` | 73 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/common/throttle.ts` | `1-56` | 56 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/contracts/tool-contract.ts` | `1-41` | 41 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/contracts/tool-result.ts` | `1-4` | 4 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/email/primitives.ts` | `1-32` | 32 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/fabric/adapters/provider-schema.ts` | `1-7` | 7 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/fabric/deterministic-policy-filter.ts` | `1-65` | 65 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/fabric/policy-filter.parity.test.ts` | `1-82` | 82 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/fabric/policy-filter.test.ts` | `1-203` | 203 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/fabric/policy-filter.ts` | `1-90` | 90 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/fabric/registry.ts` | `1-55` | 55 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/fabric/semantic-tool-candidate.ts` | `1-285` | 285 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/fabric/types.ts` | `1-32` | 32 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/harness/tool-definition-adapter.test.ts` | `1-131` | 131 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/harness/tool-definition-adapter.ts` | `1-227` | 227 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/harness/tool-split.ts` | `1-14` | 14 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/harness/types.ts` | `1-17` | 17 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/packs/calendar/manifest.ts` | `1-18` | 18 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/packs/calendar/tools/index.ts` | `1-11` | 11 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/packs/inbox/manifest.ts` | `1-18` | 18 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/packs/inbox/tools/index.ts` | `1-8` | 8 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/packs/loader.ts` | `1-67` | 67 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/packs/manifest-schema.ts` | `1-17` | 17 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/packs/memory/manifest.ts` | `1-18` | 18 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/packs/memory/tools/index.ts` | `1-8` | 8 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/packs/policy/manifest.ts` | `1-20` | 20 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/packs/registry.test.ts` | `1-19` | 19 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/packs/registry.ts` | `1-17` | 17 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/packs/web/manifest.ts` | `1-18` | 18 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/packs/web/tools/index.ts` | `1-8` | 8 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/plugins/loader.ts` | `1-20` | 20 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/plugins/policy.ts` | `1-40` | 40 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/plugins/registry.ts` | `1-53` | 53 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/plugins/types.ts` | `1-16` | 16 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/policy/policy-matcher.test.ts` | `1-102` | 102 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/policy/policy-matcher.ts` | `1-84` | 84 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/policy/policy-resolver.test.ts` | `1-94` | 94 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/policy/policy-resolver.ts` | `1-308` | 308 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/policy/tool-policy.parity.test.ts` | `1-37` | 37 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/policy/tool-policy.ts` | `1-308` | 308 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/policy/tool-policy.web.test.ts` | `1-11` | 11 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/policy/types.ts` | `1-46` | 46 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/providers/calendar.test.ts` | `1-228` | 228 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/providers/calendar.ts` | `1-502` | 502 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/providers/email.search.test.ts` | `1-614` | 614 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/providers/email.ts` | `1-1137` | 1137 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/providers/types.ts` | `1-36` | 36 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/registry/index.ts` | `1-32` | 32 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/calendar.conflicts.test.ts` | `1-73` | 73 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/calendar.timezone.test.ts` | `1-195` | 195 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/calendar.ts` | `1-1750` | 1750 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/context.ts` | `1-41` | 41 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/email.concepts.test.ts` | `1-58` | 58 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/email.timezone.test.ts` | `1-361` | 361 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/email.ts` | `1-2300` | 2300 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/email.unreplied.test.ts` | `1-250` | 250 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/errors.ts` | `1-93` | 93 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/executors/calendar.ts` | `1-73` | 73 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/executors/email.ts` | `1-163` | 163 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/executors/index.test.ts` | `1-13` | 13 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/executors/index.ts` | `1-33` | 33 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/executors/memory.ts` | `1-22` | 22 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/executors/planner.ts` | `1-27` | 27 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/executors/policy.ts` | `1-66` | 66 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/executors/search.ts` | `1-8` | 8 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/executors/task.ts` | `1-16` | 16 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/executors/types.ts` | `1-15` | 15 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/executors/utils.ts` | `1-22` | 22 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/executors/web.test.ts` | `1-32` | 32 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/executors/web.ts` | `1-25` | 25 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/idempotency.ts` | `1-39` | 39 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/index.ts` | `1-29` | 29 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/memory.ts` | `1-308` | 308 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/planner.ts` | `1-410` | 410 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/policy.targeting.test.ts` | `1-136` | 136 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/policy.ts` | `1-644` | 644 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/registry.safety.test.ts` | `1-32` | 32 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/registry.ts` | `1-1394` | 1394 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/search.test.ts` | `1-106` | 106 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/task.test.ts` | `1-181` | 181 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/task.ts` | `1-660` | 660 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/types.ts` | `1-20` | 20 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/validators/email-search.test.ts` | `1-27` | 27 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/validators/email-search.ts` | `1-247` | 247 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/web-fetch-utils.ts` | `1-134` | 134 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/web-shared.ts` | `1-94` | 94 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/web-ssrf.test.ts` | `1-35` | 35 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/web-ssrf.ts` | `1-243` | 243 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/runtime/capabilities/web.test.ts` | `1-359` | 359 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/timezone.ts` | `1-116` | 116 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |
| `src/server/features/ai/tools/types.ts` | `1-122` | 122 | `ai_tools_skills` | Adopt Agent-SDK-style tools/skills lifecycle |

## `MODIFY_V2_WIRING` (34 files, 4394 lines)

| File | Line Span | Lines | Domain | Rationale |
|---|---|---:|---|---|
| `src/app/api/calendar/sync/reconcile/route.ts` | `1-184` | 184 | `entrypoints` | Route requests to Secretary Runtime v2 |
| `src/app/api/chat/route.ts` | `1-150` | 150 | `entrypoints` | Route requests to Secretary Runtime v2 |
| `src/app/api/chat/validation.ts` | `1-33` | 33 | `entrypoints` | Route requests to Secretary Runtime v2 |
| `src/app/api/memory/export/route.ts` | `1-88` | 88 | `entrypoints` | Route requests to Secretary Runtime v2 |
| `src/app/api/memory/forget/route.ts` | `1-143` | 143 | `entrypoints` | Route requests to Secretary Runtime v2 |
| `src/app/api/memory/recall/route.ts` | `1-40` | 40 | `entrypoints` | Route requests to Secretary Runtime v2 |
| `src/app/api/rule-plane/[id]/route.ts` | `1-112` | 112 | `entrypoints` | Route requests to Secretary Runtime v2 |
| `src/app/api/rule-plane/compile/route.ts` | `1-54` | 54 | `entrypoints` | Route requests to Secretary Runtime v2 |
| `src/app/api/rule-plane/route.ts` | `1-127` | 127 | `entrypoints` | Route requests to Secretary Runtime v2 |
| `src/app/api/surfaces/actions/route.test.ts` | `1-159` | 159 | `entrypoints` | Route requests to Secretary Runtime v2 |
| `src/app/api/surfaces/actions/route.ts` | `1-207` | 207 | `entrypoints` | Route requests to Secretary Runtime v2 |
| `src/app/api/surfaces/identity/route.test.ts` | `1-112` | 112 | `entrypoints` | Route requests to Secretary Runtime v2 |
| `src/app/api/surfaces/identity/route.ts` | `1-64` | 64 | `entrypoints` | Route requests to Secretary Runtime v2 |
| `src/app/api/surfaces/inbound/ack/route.test.ts` | `1-70` | 70 | `entrypoints` | Route requests to Secretary Runtime v2 |
| `src/app/api/surfaces/inbound/ack/route.ts` | `1-78` | 78 | `entrypoints` | Route requests to Secretary Runtime v2 |
| `src/app/api/surfaces/inbound/route.test.ts` | `1-152` | 152 | `entrypoints` | Route requests to Secretary Runtime v2 |
| `src/app/api/surfaces/inbound/route.ts` | `1-259` | 259 | `entrypoints` | Route requests to Secretary Runtime v2 |
| `src/app/api/surfaces/link-token/route.ts` | `1-69` | 69 | `entrypoints` | Route requests to Secretary Runtime v2 |
| `src/app/api/surfaces/link/route.ts` | `1-54` | 54 | `entrypoints` | Route requests to Secretary Runtime v2 |
| `src/app/api/surfaces/session/resolve/route.test.ts` | `1-82` | 82 | `entrypoints` | Route requests to Secretary Runtime v2 |
| `src/app/api/surfaces/session/resolve/route.ts` | `1-125` | 125 | `entrypoints` | Route requests to Secretary Runtime v2 |
| `src/app/api/tasks/triage/action/route.ts` | `1-79` | 79 | `entrypoints` | Route requests to Secretary Runtime v2 |
| `src/app/api/tasks/triage/audit/route.ts` | `1-24` | 24 | `entrypoints` | Route requests to Secretary Runtime v2 |
| `src/app/api/tasks/triage/route.ts` | `1-39` | 39 | `entrypoints` | Route requests to Secretary Runtime v2 |
| `src/env.ts` | `1-319` | 319 | `config` | Add secretary runtime flags and mode controls |
| `src/server/features/ai/evals/taxonomy.ts` | `1-502` | 502 | `ai_eval` | Rebaseline evals to secretary reliability KPIs |
| `src/server/scripts/backfill-embeddings.ts` | `1-175` | 175 | `scripts` | Update eval/verification scripts for v2 runtime gates |
| `src/server/scripts/backfill-user-summary.ts` | `1-126` | 126 | `scripts` | Update eval/verification scripts for v2 runtime gates |
| `src/server/scripts/memory-recall-eval.ts` | `1-140` | 140 | `scripts` | Update eval/verification scripts for v2 runtime gates |
| `src/server/scripts/migrate-about.ts` | `1-107` | 107 | `scripts` | Update eval/verification scripts for v2 runtime gates |
| `src/server/scripts/search-ranking-calibrate.ts` | `1-114` | 114 | `scripts` | Update eval/verification scripts for v2 runtime gates |
| `src/server/scripts/verify-embedding-contract.ts` | `1-108` | 108 | `scripts` | Update eval/verification scripts for v2 runtime gates |
| `src/server/scripts/verify_rlm.ts` | `1-143` | 143 | `scripts` | Update eval/verification scripts for v2 runtime gates |
| `src/server/scripts/verify_unified_context.ts` | `1-156` | 156 | `scripts` | Update eval/verification scripts for v2 runtime gates |

## `PRUNE_OR_DEFER_NON_SECRETARY` (54 files, 8708 lines)

| File | Line Span | Lines | Domain | Rationale |
|---|---|---:|---|---|
| `src/server/features/ai/proactive/orchestrator.test.ts` | `1-105` | 105 | `ai_proactive` | Defer proactive subsystem until core secretary reliability is stable |
| `src/server/features/ai/proactive/orchestrator.ts` | `1-185` | 185 | `ai_proactive` | Defer proactive subsystem until core secretary reliability is stable |
| `src/server/features/ai/proactive/scanner.ts` | `1-161` | 161 | `ai_proactive` | Defer proactive subsystem until core secretary reliability is stable |
| `src/server/features/ai/proactive/types.ts` | `1-22` | 22 | `ai_proactive` | Defer proactive subsystem until core secretary reliability is stable |
| `src/server/features/assistant-email/is-assistant-email.test.ts` | `1-85` | 85 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/assistant-email/is-assistant-email.ts` | `1-36` | 36 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/assistant-email/process-assistant-email.ts` | `1-289` | 289 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/categorize/ai/ai-categorize-senders.ts` | `1-202` | 202 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/categorize/ai/ai-categorize-single-sender.ts` | `1-103` | 103 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/categorize/ai/format-categories.ts` | `1-10` | 10 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/categorize/ai/heuristics.ts` | `1-93` | 93 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/categorize/senders/categorize.ts` | `1-196` | 196 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/follow-up/cleanup.test.ts` | `1-167` | 167 | `supporting_domain` | Defer optional follow-up automation until core reliability target |
| `src/server/features/follow-up/cleanup.ts` | `1-114` | 114 | `supporting_domain` | Defer optional follow-up automation until core reliability target |
| `src/server/features/follow-up/generate-draft.test.ts` | `1-287` | 287 | `supporting_domain` | Defer optional follow-up automation until core reliability target |
| `src/server/features/follow-up/generate-draft.ts` | `1-150` | 150 | `supporting_domain` | Defer optional follow-up automation until core reliability target |
| `src/server/features/follow-up/labels.test.ts` | `1-320` | 320 | `supporting_domain` | Defer optional follow-up automation until core reliability target |
| `src/server/features/follow-up/labels.ts` | `1-150` | 150 | `supporting_domain` | Defer optional follow-up automation until core reliability target |
| `src/server/features/groups/ai/find-newsletters.test.ts` | `1-43` | 43 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/groups/ai/find-newsletters.ts` | `1-42` | 42 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/groups/ai/find-receipts.test.ts` | `1-65` | 65 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/groups/ai/find-receipts.ts` | `1-160` | 160 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/groups/find-matching-group.test.ts` | `1-157` | 157 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/groups/find-matching-group.ts` | `1-99` | 99 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/groups/group-item.ts` | `1-34` | 34 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/knowledge/ai/extract-from-email-history.ts` | `1-191` | 191 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/knowledge/ai/extract.ts` | `1-120` | 120 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/knowledge/ai/persona.ts` | `1-145` | 145 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/knowledge/ai/writing-style.ts` | `1-108` | 108 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/meeting-briefs/ai/generate-briefing.test.ts` | `1-174` | 174 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/meeting-briefs/ai/generate-briefing.ts` | `1-298` | 298 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/meeting-briefs/fetch-upcoming-events.ts` | `1-65` | 65 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/meeting-briefs/gather-context.ts` | `1-261` | 261 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/meeting-briefs/process.ts` | `1-328` | 328 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/meeting-briefs/recipient-context.test.ts` | `1-495` | 495 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/meeting-briefs/recipient-context.ts` | `1-241` | 241 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/reply-tracker/ai/check-if-needs-reply.ts` | `1-92` | 92 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/reply-tracker/ai/determine-thread-status.test.ts` | `1-96` | 96 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/reply-tracker/ai/determine-thread-status.ts` | `1-213` | 213 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/reply-tracker/ai/draft-follow-up.ts` | `1-145` | 145 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/reply-tracker/ai/draft-reply.ts` | `1-272` | 272 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/reply-tracker/ai/generate-nudge.ts` | `1-56` | 56 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/reply-tracker/ai/reply-context-collector.ts` | `1-160` | 160 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/reply-tracker/check-sender-reply-history.ts` | `1-59` | 59 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/reply-tracker/conversation-status-config.ts` | `1-23` | 23 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/reply-tracker/draft-tracking.ts` | `1-288` | 288 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/reply-tracker/generate-draft.test.ts` | `1-232` | 232 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/reply-tracker/generate-draft.ts` | `1-319` | 319 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/reply-tracker/handle-conversation-status.ts` | `1-170` | 170 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/reply-tracker/handle-outbound.ts` | `1-83` | 83 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/reply-tracker/label-helpers.test.ts` | `1-346` | 346 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/reply-tracker/label-helpers.ts` | `1-241` | 241 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/reply-tracker/outbound.test.ts` | `1-82` | 82 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |
| `src/server/features/reply-tracker/outbound.ts` | `1-130` | 130 | `non_secretary_features` | Not required for focused inbox/calendar secretary core |

## `PRUNE_FROM_SECRETARY_MODE` (24 files, 6611 lines)

| File | Line Span | Lines | Domain | Rationale |
|---|---|---:|---|---|
| `src/server/features/ai/runtime/deterministic-cross-surface.ts` | `1-381` | 381 | `ai_runtime` | Out-of-scope in secretary-only operational surface |
| `src/server/features/ai/tools/runtime/capabilities/search.ts` | `1-282` | 282 | `ai_runtime` | Out-of-scope in secretary-only operational surface |
| `src/server/features/ai/tools/runtime/capabilities/web.ts` | `1-1391` | 1391 | `ai_runtime` | Out-of-scope in secretary-only operational surface |
| `src/server/features/search/index/backfill.ts` | `1-133` | 133 | `search_plane` | Disable generic search plane in secretary strict mode |
| `src/server/features/search/index/chunking.ts` | `1-37` | 37 | `search_plane` | Disable generic search plane in secretary strict mode |
| `src/server/features/search/index/index.ts` | `1-5` | 5 | `search_plane` | Disable generic search plane in secretary strict mode |
| `src/server/features/search/index/ingestors/calendar.ts` | `1-107` | 107 | `search_plane` | Disable generic search plane in secretary strict mode |
| `src/server/features/search/index/ingestors/email.ts` | `1-129` | 129 | `search_plane` | Disable generic search plane in secretary strict mode |
| `src/server/features/search/index/ingestors/memory.ts` | `1-163` | 163 | `search_plane` | Disable generic search plane in secretary strict mode |
| `src/server/features/search/index/ingestors/rule.ts` | `1-110` | 110 | `search_plane` | Disable generic search plane in secretary strict mode |
| `src/server/features/search/index/queue.ts` | `1-171` | 171 | `search_plane` | Disable generic search plane in secretary strict mode |
| `src/server/features/search/index/repository.ts` | `1-751` | 751 | `search_plane` | Disable generic search plane in secretary strict mode |
| `src/server/features/search/index/types.ts` | `1-52` | 52 | `search_plane` | Disable generic search plane in secretary strict mode |
| `src/server/features/search/unified/calibration.test.ts` | `1-97` | 97 | `search_plane` | Disable generic search plane in secretary strict mode |
| `src/server/features/search/unified/calibration.ts` | `1-192` | 192 | `search_plane` | Disable generic search plane in secretary strict mode |
| `src/server/features/search/unified/query.test.ts` | `1-171` | 171 | `search_plane` | Disable generic search plane in secretary strict mode |
| `src/server/features/search/unified/query.ts` | `1-358` | 358 | `search_plane` | Disable generic search plane in secretary strict mode |
| `src/server/features/search/unified/ranking.test.ts` | `1-72` | 72 | `search_plane` | Disable generic search plane in secretary strict mode |
| `src/server/features/search/unified/ranking.ts` | `1-368` | 368 | `search_plane` | Disable generic search plane in secretary strict mode |
| `src/server/features/search/unified/service.test.ts` | `1-234` | 234 | `search_plane` | Disable generic search plane in secretary strict mode |
| `src/server/features/search/unified/service.ts` | `1-1034` | 1034 | `search_plane` | Disable generic search plane in secretary strict mode |
| `src/server/features/search/unified/types.ts` | `1-133` | 133 | `search_plane` | Disable generic search plane in secretary strict mode |
| `src/server/features/search/unified/weights.test.ts` | `1-70` | 70 | `search_plane` | Disable generic search plane in secretary strict mode |
| `src/server/features/search/unified/weights.ts` | `1-170` | 170 | `search_plane` | Disable generic search plane in secretary strict mode |

