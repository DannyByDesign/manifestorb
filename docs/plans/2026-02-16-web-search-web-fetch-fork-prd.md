# 2026-02-16 PRD: Fork OpenClaw `web_search` + `web_fetch` into `amodel`

## 1. Document Purpose

This PRD defines exactly how to add first-class web research capabilities to `amodel` by forking and adapting OpenClaw's `web_search` and `web_fetch` tool implementations into the `amodel` runtime architecture.

This is written so a fresh AI agent can execute end-to-end without prior session context.

---

## 2. Problem Statement

`amodel` currently has no general runtime web search/fetch tools.  
Users cannot ask the assistant to do broad internet research as part of normal agent workflows.

Current state:

- No web capability family in runtime registry:
  - `src/server/features/ai/tools/runtime/capabilities/registry.ts`
- No web capability constructor:
  - `src/server/features/ai/tools/runtime/capabilities/index.ts`
- No web executors:
  - `src/server/features/ai/tools/runtime/capabilities/executors/index.ts`
- No web pack in internal tool packs:
  - `src/server/features/ai/tools/packs/registry.ts`

Only one narrow web lookup path exists inside meeting briefing generation:

- `src/server/features/meeting-briefs/ai/generate-briefing.ts` uses `google.tools.googleSearch` for per-guest enrichment.

This is not a reusable runtime tool and does not solve agent-wide web research.

---

## 3. Product Goal

Add robust, policy-governed, production-safe web tools to the runtime:

- `web.search`: internet search with provider abstraction.
- `web.fetch`: URL fetch + readable extraction, with SSRF protections.

Behavior must be available to agent workflows, not only feature-specific code.

---

## 4. Source of Truth to Fork From

Primary upstream implementation (OpenClaw):

- Web search:
  - `/Users/dannywang/Projects/openclaw/src/agents/tools/web-search.ts`
- Web fetch:
  - `/Users/dannywang/Projects/openclaw/src/agents/tools/web-fetch.ts`
- Shared cache/timeout utilities:
  - `/Users/dannywang/Projects/openclaw/src/agents/tools/web-shared.ts`
- SSRF utilities:
  - `/Users/dannywang/Projects/openclaw/src/infra/net/ssrf.ts`
- Tool policy groups:
  - `/Users/dannywang/Projects/openclaw/src/agents/tool-policy.ts`
- Tool registration:
  - `/Users/dannywang/Projects/openclaw/src/agents/openclaw-tools.ts`
- Tests:
  - `/Users/dannywang/Projects/openclaw/src/agents/tools/web-search.test.ts`
  - `/Users/dannywang/Projects/openclaw/src/agents/tools/web-tools.enabled-defaults.test.ts`
  - `/Users/dannywang/Projects/openclaw/src/agents/tools/web-fetch.ssrf.test.ts`

---

## 5. External Documentation References (Implementation Guidance)

- OpenClaw web tools docs:
  - https://docs.openclaw.ai/tools/web
- OpenClaw gateway config (web sections):
  - https://docs.openclaw.ai/gateway/configuration
- Brave Search API:
  - https://brave.com/search/api/
- Perplexity API docs:
  - https://docs.perplexity.ai/
- OpenRouter docs (if Perplexity via OpenRouter is supported):
  - https://openrouter.ai/docs/api-reference
- OWASP SSRF prevention guidance:
  - https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html

---

## 6. In-Scope vs Out-of-Scope

### In Scope

- Add runtime web search tool (`web.search`) in `amodel`.
- Add runtime web fetch tool (`web.fetch`) in `amodel`.
- Add secure HTTP fetch path with SSRF defenses and redirect checks.
- Wire tools through capability registry, executors, tool packs, and policy groups.
- Add tests for search behavior, provider config behavior, and SSRF protections.
- Add env/config definitions for required keys and defaults.

### Out of Scope

- Browser automation tooling (CDP/browser control).
- UI redesign for search settings.
- Full plugin marketplace/tool marketplace changes.
- Replacing existing meeting-brief specific web lookup in this phase (can be follow-up).

---

## 7. `amodel` Runtime Integration Targets

Integration must align with existing architecture:

- Capability definitions:
  - `src/server/features/ai/tools/runtime/capabilities/registry.ts`
- Capability assembly:
  - `src/server/features/ai/tools/runtime/capabilities/index.ts`
- Executors:
  - `src/server/features/ai/tools/runtime/capabilities/executors/index.ts`
- Pack manifests/pack registry:
  - `src/server/features/ai/tools/packs/registry.ts`
  - New `web` pack files under `src/server/features/ai/tools/packs/web/*`
- Policy groups:
  - `src/server/features/ai/tools/policy/tool-policy.ts`
- Tool loading:
  - `src/server/features/ai/tools/packs/loader.ts`

Do not bolt web tools into ad hoc feature files only.

---

## 8. Functional Requirements

### FR-1: `web.search` Tool

Inputs:

- `query` (required string)
- `count` (optional int, bounded)
- `country` (optional string)
- `search_lang` (optional string)
- `ui_lang` (optional string)
- `freshness` (optional; Brave-only semantics)

Behavior:

- Supports provider selection:
  - `brave` (default)
  - `perplexity` (optional)
- Resolves API keys from env/config.
- Validates parameters (including freshness).
- Returns normalized structured payload:
  - provider
  - tookMs
  - results (Brave) OR content + citations (Perplexity)
- Uses short TTL cache to reduce duplicate calls and cost.
- Returns deterministic structured error payload for missing keys/invalid args.

### FR-2: `web.fetch` Tool

Inputs:

- `url` (required; http/https only)
- `extractMode` (optional: `markdown|text`)
- `maxChars` (optional bounded int)

Behavior:

- Fetches URL with timeout.
- Follows redirects up to bounded limit.
- Blocks SSRF/private/internal targets before fetch and after redirects.
- Extracts readable content (readability-style extraction path).
- Optional Firecrawl fallback if configured.
- Returns normalized payload:
  - finalUrl
  - status
  - extractor
  - content (truncated by max chars)

### FR-3: Runtime Wiring

- `web.search` and `web.fetch` must be available in normal runtime tool selection/execution flow.
- Must participate in policy filtering and allow/deny group semantics.

### FR-4: Policy Grouping

- Add `group:web` and include both tools.
- Ensure allowlist/denylist resolution works with existing policy expansion logic.

---

## 9. Non-Functional Requirements

### NFR-1 Security

- SSRF-safe hostname/IP validation, including:
  - localhost
  - `.local`/`.internal`
  - private IPv4 ranges
  - private IPv6 ranges
  - DNS rebinding-safe pinned lookup behavior for resolved hosts
- Redirect chain re-validation required.

### NFR-2 Reliability

- Timeouts on outbound web requests.
- Graceful error envelopes (no raw stack leaks).
- Bounded caches (size + TTL).

### NFR-3 Cost/Latency

- Default bounded result count and content size.
- Cache enabled by default.
- Provider calls measured (`tookMs`).

### NFR-4 Observability

- Log warnings/errors with structured metadata.
- No secrets in logs.

---

## 10. Proposed `amodel` Config and Env Additions

Add server env vars in `src/env.ts` (optional unless provider enabled):

- `BRAVE_API_KEY` (optional)
- `PERPLEXITY_API_KEY` (optional)
- `OPENROUTER_API_KEY` (optional)
- `FIRECRAWL_API_KEY` (optional)

Add runtime config surface (new or existing AI config path), minimally:

- `tools.web.search.enabled`
- `tools.web.search.provider`
- `tools.web.search.maxResults`
- `tools.web.search.timeoutSeconds`
- `tools.web.search.cacheTtlMinutes`
- `tools.web.search.perplexity.apiKey`
- `tools.web.search.perplexity.baseUrl`
- `tools.web.search.perplexity.model`
- `tools.web.fetch.enabled`
- `tools.web.fetch.maxChars`
- `tools.web.fetch.timeoutSeconds`
- `tools.web.fetch.cacheTtlMinutes`
- `tools.web.fetch.maxRedirects`
- `tools.web.fetch.userAgent`
- `tools.web.fetch.readability`
- `tools.web.fetch.firecrawl.*`

If `amodel` has no formal tool config object yet, implement defaults in capability layer and read env keys first.

---

## 11. Code Design in `amodel`

### 11.1 New Capability Module

Create:

- `src/server/features/ai/tools/runtime/capabilities/web.ts`

Exports:

- `createWebCapabilities(env): { search(...), fetch(...) }`

Responsibilities:

- Encapsulate provider resolution, validation, request execution, caching, and normalized `ToolResult`.

### 11.2 New Executor Module

Create:

- `src/server/features/ai/tools/runtime/capabilities/executors/web.ts`

Mappings:

- `web.search` -> `capabilities.web.search`
- `web.fetch` -> `capabilities.web.fetch`

### 11.3 Registry Additions

Update:

- `src/server/features/ai/tools/runtime/capabilities/registry.ts`

Add tool definitions:

- `web.search` (read-only, safe, `approvalOperation: "query"`)
- `web.fetch` (read-only, safe, `approvalOperation: "get"`)

Add intent families/tags consistent with runtime taxonomy.

### 11.4 Capability Assembly

Update:

- `src/server/features/ai/tools/runtime/capabilities/index.ts`

Add:

- `web: createWebCapabilities(env)`

### 11.5 Executor Assembly

Update:

- `src/server/features/ai/tools/runtime/capabilities/executors/index.ts`

Merge:

- `...webToolExecutors`

### 11.6 Tool Pack

Add:

- `src/server/features/ai/tools/packs/web/manifest.ts`
- `src/server/features/ai/tools/packs/web/tools/index.ts`

Update:

- `src/server/features/ai/tools/packs/registry.ts` to include `webToolPackManifest()`.

### 11.7 Policy Groups

Update:

- `src/server/features/ai/tools/policy/tool-policy.ts`

Add:

- `group:web`: `["web.search", "web.fetch"]`

---

## 12. Security Design (Mandatory)

Fork and adapt OpenClaw SSRF strategy:

- Hostname blocklist + private IP checks.
- DNS resolve then pin addresses for request path.
- Re-check each redirect target.
- Reject non-http/https schemes.
- Limit redirect count.
- Ensure `web.fetch` never reaches private/internal networks.

Implementation options:

- Preferred: fork OpenClaw `ssrf.ts` into `amodel` utility module and adapt to project conventions.
- Required tests must prove blocking behavior.

---

## 13. Data Contracts (Tool Result Shape)

`web.search` success payload:

- `query`
- `provider`
- `tookMs`
- Brave path:
  - `count`
  - `results[]`: `title`, `url`, `description`, `published?`, `siteName?`
- Perplexity path:
  - `model`
  - `content`
  - `citations[]`
- `cached?`

`web.fetch` success payload:

- `url`
- `finalUrl`
- `status`
- `extractor` (`readability`, `firecrawl`, `raw`)
- `content` (truncated)
- `cached?`

Error payload requirements:

- Stable `error` code
- Human-readable `message`
- Optional `docs` URL for setup issues

---

## 14. Testing Requirements

### 14.1 Unit Tests (Required)

Create/extend tests under:

- `src/server/features/ai/tools/runtime/capabilities/*.test.ts`

Required cases:

1. `web.search` provider/key resolution:
   - Brave key missing -> setup error payload
   - Perplexity key missing -> setup error payload
2. `web.search` param handling:
   - country/search_lang/ui_lang passthrough
   - freshness validation + provider restriction
3. `web.search` caching:
   - repeated query returns cached marker
4. `web.fetch` URL validation:
   - non-http(s) rejected
5. `web.fetch` SSRF:
   - localhost/private IP blocked
   - DNS-resolved private IP blocked
   - redirect to private target blocked
6. `web.fetch` extraction:
   - successful fetch returns normalized payload
7. executor wiring:
   - `web.search` and `web.fetch` resolve in executor map
8. registry/pack wiring:
   - tool definitions present and loadable through pack loader

### 14.2 Regression/Integration

- Ensure existing runtime tests continue to pass:
  - tool assembly
  - policy filter
  - runtime harness execution

---

## 15. Execution Backlog (Atomic, Ordered)

### Issue WSF-01: Add capability definitions

- Edit `registry.ts` with `web.search` + `web.fetch`.
- Add tags, risk level, approval operation, and schemas.
- DoD: registry includes both tools and typecheck passes.

### Issue WSF-02: Implement `web` capability module

- Create `capabilities/web.ts`.
- Port/adapt OpenClaw logic for:
  - provider resolution
  - param parsing
  - caching
  - outbound HTTP + timeout
- DoD: direct unit tests for module pass.

### Issue WSF-03: Implement SSRF utility

- Add SSRF module (adapted from OpenClaw `ssrf.ts`).
- Use in `web.fetch` request path.
- DoD: SSRF tests pass for blocked/allowed cases.

### Issue WSF-04: Add executor wiring

- Create `executors/web.ts`.
- Merge into `executors/index.ts`.
- DoD: runtime executor resolves `web.search`, `web.fetch`.

### Issue WSF-05: Add capability assembly wiring

- Update `capabilities/index.ts` to include `web`.
- DoD: runtime capabilities object exposes `web`.

### Issue WSF-06: Add web tool pack

- Add web pack manifest + tool list.
- Register in pack registry.
- DoD: pack loader includes both web tools.

### Issue WSF-07: Add policy group support

- Update `tool-policy.ts` with `group:web`.
- DoD: allow/deny expansions include both web tools.

### Issue WSF-08: Add env/config support

- Update `src/env.ts` (and config surfaces if present).
- DoD: keys parse correctly and defaults are safe.

### Issue WSF-09: Add tests

- Port/adapt core tests from OpenClaw coverage.
- Add `amodel` runtime-specific wiring tests.
- DoD: targeted tests green.

### Issue WSF-10: Docs and attribution

- Add inline attribution comments in forked files.
- Add operator docs in `docs/` for enabling providers.
- DoD: docs include setup + safety notes.

---

## 16. Acceptance Criteria (Release Gate)

All must pass:

1. Agent can execute `web.search` in runtime tool loop.
2. Agent can execute `web.fetch` in runtime tool loop.
3. `group:web` allow/deny policy works.
4. SSRF tests prove private/internal targets are blocked.
5. Tool errors are structured and user-safe.
6. Typecheck + lint + relevant test suites pass.
7. Attribution present for forked OpenClaw-derived logic.

---

## 17. Rollout Plan

Phase 1 (default-on with key presence):

- Enable `web.search` only when provider key exists.
- Keep `web.fetch` enabled with strict SSRF and bounded limits.

Phase 2:

- Add telemetry dashboard for tool usage/error rates.
- Add eval prompts for research-heavy email/calendar tasks.

Phase 3:

- Consider replacing meeting-brief ad hoc `google_search` path with `web.search` runtime capability for consistency.

---

## 18. Risks and Mitigations

Risk: SSRF/security regression.  
Mitigation: copy proven SSRF approach + dedicated tests.

Risk: Runtime integration mismatch from direct transplant.  
Mitigation: adapt to capability/executor/pack architecture; no direct `AnyAgentTool` transplant.

Risk: provider cost and latency spikes.  
Mitigation: strict defaults, caching, timeout bounds.

Risk: policy bypass.  
Mitigation: tool registration only through existing pack + policy filter layers.

---

## 19. Fresh-Agent Start Instructions

If you are a fresh AI agent taking over this work:

1. Read this PRD fully.
2. Read these `amodel` files first:
   - `src/server/features/ai/tools/runtime/capabilities/registry.ts`
   - `src/server/features/ai/tools/runtime/capabilities/index.ts`
   - `src/server/features/ai/tools/runtime/capabilities/executors/index.ts`
   - `src/server/features/ai/tools/packs/registry.ts`
   - `src/server/features/ai/tools/policy/tool-policy.ts`
3. Read OpenClaw source files listed in Section 4.
4. Execute backlog in Section 15, in order.
5. After each issue, run targeted tests before moving on.
6. Do not ship without SSRF tests and policy wiring tests passing.

---

## 20. Appendix: Fork Snippets (Reference)

### A. Search provider constants (OpenClaw pattern)

```ts
const SEARCH_PROVIDERS = ["brave", "perplexity"] as const;
const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const DEFAULT_PERPLEXITY_BASE_URL = "https://openrouter.ai/api/v1";
```

Source: `/Users/dannywang/Projects/openclaw/src/agents/tools/web-search.ts`

### B. SSRF blocked hostname/private IP pattern

```ts
if (isBlockedHostname(normalized)) {
  throw new SsrFBlockedError(`Blocked hostname: ${hostname}`);
}
if (isPrivateIpAddress(normalized)) {
  throw new SsrFBlockedError("Blocked: private/internal IP address");
}
```

Source: `/Users/dannywang/Projects/openclaw/src/infra/net/ssrf.ts`

### C. `group:web` policy group pattern

```ts
"group:web": ["web_search", "web_fetch"],
```

Source: `/Users/dannywang/Projects/openclaw/src/agents/tool-policy.ts`

