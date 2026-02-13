# Codebase Issues & Problems

> Comprehensive list of issues identified during codebase analysis, categorized by severity and type.
> **Last Verified:** 2026-01-31 (Extensive Double-Check)

---

## Critical Issues

### 1. [RESOLVED] Missing Environment Variable
**Status:** ✅ Resolved. `BRAINTRUST_API_KEY` is present in `src/env.ts`.

### 2. [RESOLVED] Code Duplication - permissions.ts (Gmail)
**Status:** ✅ Resolved. `utils/gmail/` does not exist.

### 3. [RESOLVED] Code Duplication - permissions.ts (Actions)
**Status:** ✅ Resolved. `utils/actions/` does not exist.

### 4. [RESOLVED] Code Duplication - cold-email.validation.ts
**Status:** ✅ Resolved. Consolidated.

### 5. [RESOLVED] Code Duplication - report.ts
**Status:** ✅ Resolved. Consolidated.

### 6. [RESOLVED] Import Path Inconsistency
**Status:** ✅ Resolved. `src/server/lib/prisma.ts` is now a re-export, preventing double-instantiation.

### 7. [RESOLVED] Incomplete Feature - Multiple Rule Matching
**Status:** ✅ Resolved. `processUserRequest` now handles multiple rule contexts.

### 8. [OPEN] Incomplete Feature - Outlook Permissions
**Status:** 🔴 **Critical**. `src/server/actions/permissions.ts` still contains `// TODO: add Outlook handling`. Outlook users bypass checks.

### 9. [RESOLVED] Incomplete Error Handling - Permissions
**Status:** ✅ Resolved. Added robust network/API error handling in `checkGmailPermissions`.

### 10. [RESOLVED] Incomplete Error Handling - Middleware
**Status:** ✅ Resolved. Verified production logging strategy.

### 11. [OPEN] Type Workaround - internalDate
**Status:** ⚠️ **Open**. Hacky Zod union type (`string | number`) still persists.

### 12. [OPEN] Deprecated Fields in Schema
**Status:** ⚠️ **Open**. `coldEmailBlocker`, `automate`, and others are still in `schema.prisma`.

### 18. [OPEN] feature Stubs - Agent Tools
**Status:** 🔴 **Critical**.
- `get` tool returns "Not implemented" for `calendar` and `automation`.
- `create`/`modify` tools are missing for Calendar.
- **Impact**: Agent cannot manage time or rules, breaking core promises.

### 19. [OPEN] Missing Feature - Microsoft Webhooks
**Status:** 🔴 **Critical**.
- No `src/app/api/microsoft` directory.
- **Impact**: Outlook emails do not trigger real-time updates; Agent is blind to incoming Outlook mail until polling (if implemented) or manual sync.

### 20. [RESOLVED] UX Gap - Approval Feedback Loop

**Status:** ✅ Resolved.

**Issue:** Approval route did not notify the user/chat after successful execution.

**Fix Implemented:**
- Integrated `ChannelRouter.pushMessage` into the approval route.
- **Enhanced**: Now uses LLM ("chat" model) to generate context-aware, natural confirmation messages.
- Ensures the chat loop is closed using the Agent's specific persona.

---

### 21. [OPEN] Scalability Risk - In-Memory Rate Limiting
**Status:** ⚠️ **Open / Deferred**.
- `src/server/features/ai/tools/security.ts` uses a JavaScript `Map` for rate limits.
- **Impact**: Fails in serverless (Next.js) environments where memory is not shared between requests.
- **Proposed Solution (Quota System)**: Instead of rate-limiting, enforce a **Cost Quota** via `checkQuota(user)` using existing `usage.ts` tracking. This controls spend directly.

### 22. [RESOLVED] Strict Type Safety Violations
**Status:** ✅ Resolved. Eliminated `any` in critical paths (`chat.ts`, `posthog.ts`).

### 23. [RESOLVED] Production Logging in API Routes
**Status:** ✅ Resolved.
- **Fix**: Replaced `console.log` with `createScopedLogger` in `approve/route.ts`.

### 24. [RESOLVED] Unsafe Environment Variable Usage
**Status:** ✅ Resolved.
- **Fix**: Added `JOBS_SHARED_SECRET` to `env.ts` and local Zod validation for `tinybird-ai-analytics`.

### 25. [OPEN] Missing Error Handling in Job Routes
**Status:** ⚠️ **Open**.
- Async API routes lack `try/catch`. Risk of silent failures.



---

## Low Priority Issues

### 13. [RESOLVED] Directory Structure Overlap
**Status:** ✅ Resolved. `utils/actions/` was deleted, resolving the overlap with `services/unsubscriber`.

### 14. [RESOLVED] Default README Not Updated
**Status:** ✅ Resolved. `NEXT-README.md` is gone, `README.md` is updated.

### 15. [OPEN] Mixed Import Path Aliases
**Status:** ⚠️ **Open**. Inconsistent use of `@/utils` vs `@/server/utils`.

### 16. [RESOLVED] Potential Dead Code & Duplication
**Status:** ✅ Resolved.
- Deleted duplicate `prompt-to-rules-old.ts` in `server/utils/ai/rule/`.
- Consolidated all imports to `server/integrations/ai/rule/`.
- Updated tests to use the canonical location.

### 17. [OPEN] Test Coverage Gaps
**Status:** ⚠️ **Open**. Microsoft integration lacks webhooks and test coverage.

---

## Recommended Actions (Updated)

### Immediate Priority
1. **Fix Outlook Permissions (Issue 8)**: This allows users to bypass security checks.
2. **Delete Duplicate Dead Code (Issue 16)**: Remove `prompt-to-rules-old.ts` from both locations if unused.
3. **Consolidate Prisma Imports (Issue 6)**: prevent double-instantiation.

### Short Term
1. **Schema Cleanup (Issue 12)**: Remove deprecated fields to prevent confusion.
2. **Error Handling (Issue 9, 10)**: Harden middleware and provider error catching.

> Comprehensive list of issues identified during codebase analysis, categorized by severity and type.

---

## Table of Contents

1. [Critical Issues](#critical-issues)
2. [Medium Priority Issues](#medium-priority-issues)
3. [Low Priority Issues](#low-priority-issues)
4. [Technical Debt](#technical-debt)
5. [Security Notes](#security-notes)
6. [Recommended Actions](#recommended-actions)

---

## Critical Issues

### 1. [RESOLVED] Missing Environment Variable

**Status:** ✅ Resolved via `src/env.ts` update.

**Issue:** `BRAINTRUST_API_KEY` is used in code but not defined in the environment schema.

**Location:** `src/server/lib/braintrust.ts` (line ~11)

**Impact:** Runtime errors if Braintrust functionality is invoked without the env var being defined.

**Fix:**
```typescript
// Added to src/env.ts in server section
BRAINTRUST_API_KEY: z.string().optional(),
```

---

### 2. [RESOLVED] Code Duplication - permissions.ts (Gmail)

**Status:** ✅ Resolved. Deleted `utils/gmail/` and pointed all imports to `integrations/google/`.

**Issue:** Identical file exists in two locations with different import paths.

**Locations:**
- `src/server/lib/gmail/permissions.ts` (DELETED)
- `src/server/integrations/google/permissions.ts` (KEPT)

**Differences:**
```typescript
// Location 1: utils/gmail/permissions.ts
import { scopes } from "@/utils/gmail/scopes";
import { prisma } from "@/utils/prisma";

// Location 2: integrations/google/permissions.ts  
import { scopes } from "@/server/integrations/google/scopes";
import { prisma } from "@/server/db/client";
```

**Impact:** Maintenance risk - changes need to be made in both places.

**Fix:** Delete one file, update all imports to use the canonical location.

---

### 3. [RESOLVED] Code Duplication - permissions.ts (Actions)

**Status:** ✅ Resolved. Deleted `utils/actions/permissions.ts` (unused).

**Issue:** Identical file exists in two locations.

**Locations:**
- `src/server/lib/actions/permissions.ts` (DELETED)
- `src/server/actions/permissions.ts` (KEPT)

**Code:** 83 lines, identical functionality.

**Fix:** Keep `services/unsubscriber/permissions.ts`, delete the other, update imports.

---

### 4. [RESOLVED] Code Duplication - cold-email.validation.ts

**Status:** ✅ Resolved. Consolidated to `services/unsubscriber/`.

**Issue:** Identical validation schema in two locations.

**Locations:**
- `src/server/lib/actions/cold-email.validation.ts` (DELETED)
- `src/server/actions/cold-email.validation.ts` (KEPT)

**Both contain a hacky fix:**
```typescript
// Hacky fix. Not sure why this happens. 
// Is internalDate sometimes a string and sometimes a number?
internalDate: z.string().or(z.number()),
```

**Impact:** Bug in underlying code causing type inconsistency is masked by workaround.

**Fix:** 
1. Investigate root cause of `internalDate` type inconsistency
2. Fix at source (Gmail API response parsing)
3. Remove duplicate file

---

### 5. [RESOLVED] Code Duplication - report.ts

**Status:** ✅ Resolved. Removed `utils` version in favor of `services` version.

**Issue:** Both files duplicate the `fetchGmailLabels` function.

**Locations:**
- `src/server/lib/actions/report.ts` (DELETED)
- `src/server/actions/report.ts` (KEPT)

**Both have TODO:**
```typescript
// TODO: should be able to import this functionality from elsewhere
```

**Fix:** Extract `fetchGmailLabels` to a shared utility, import in both places.

---

### 6. [RESOLVED] Import Path Inconsistency

**Status:** ✅ Resolved.

**Issue:** Prisma client was duplicated in `@/utils/prisma`.

**Fix Implemented:**
- Updated `src/server/lib/prisma.ts` to re-export the canonical client from `@/server/db/client`.
- Prevents multiple Prisma instances from being instantiated.
- (Deleted: `src/server/lib/ai/assistant/process-user-request.ts` as part of Issue 7/16 work).

---

---

## Medium Priority Issues

### 7. [RESOLVED] Incomplete Feature - Multiple Rule Matching

**Status:** ✅ Resolved.

**Fix Implemented:**
- Updated `processUserRequest` to accept an array of `matchedRules`.
- Refactored prompt generation to iterate and expose all matched rules to the AI.
- Updated `processAssistantEmail` to pass all matched executed rules, filtering nulls.

---

---

### 8. [KNOWN ISSUE] Incomplete Feature - Outlook Permissions

**Status:** ⚠️ Known Issue / Deferred.

**Location:** 
- `src/server/lib/actions/permissions.ts` (line ~15)
- `src/server/actions/permissions.ts` (line ~15)

**Code:**
```typescript
// TODO: add Outlook handling
if (provider !== "google") {
  return { hasPermission: true }; // Always returns true for non-Google
}
```

**Impact:** Outlook users bypass permission checks entirely.

**Fix:** Implement proper permission checking for Microsoft Graph API.

---

### 9. [KNOWN ISSUE] Incomplete Error Handling - Permissions

**Status:** ⚠️ Known Issue / Deferred.

**Location:**
- `src/server/lib/gmail/permissions.ts` (line ~11)
- `src/server/integrations/google/permissions.ts` (line ~11)

**Code:**
```typescript
// TODO: this can also error on network error
```

**Impact:** Network errors may not be handled gracefully.

**Fix:** Add proper try-catch with network error handling.

---

### 10. [RESOLVED] Incomplete Error Handling - Middleware

**Status:** ✅ Resolved.

**Issue:** Middleware had a "Quick fix" TODO for error logging.

**Fix Implemented:**
- Verified production logging uses structured `logger` and `Sentry`.
- Formalized the `console.error` usage as Development-only pattern for debugging visibility.
- Removed TODO.

---

---

### 11. [KNOWN ISSUE] Type Workaround - internalDate

**Status:** ⚠️ Known Issue / Deferred.

**Location:** Multiple validation files

**Code:**
```typescript
// Hacky fix. Not sure why this happens.
internalDate: z.string().or(z.number()),
```

**Root Cause Analysis Needed:**
- Check Gmail API response format
- Check if type changes based on API version or request params
- May be JavaScript number precision issue for large timestamps

**Fix:** Investigate and fix at parsing layer, not validation layer.

---

### 12. [KNOWN ISSUE] Deprecated Fields in Schema

**Status:** ⚠️ Known Issue / Deferred.

**Location:** `src/server/db/prisma/schema.prisma`

**Deprecated fields kept for backward compatibility:**

| Model | Field | Reason |
|-------|-------|--------|
| `EmailAccount` | `coldEmailBlocker` | Deprecated |
| `EmailAccount` | `coldEmailDigest` | Deprecated |
| `EmailAccount` | `coldEmailPrompt` | Deprecated |
| `EmailAccount` | `rulesPrompt` | Deprecated |
| `Rule` | `automate` | No longer used - all rules automated |
| `Rule` | `categoryFilterType` | Deprecated |
| `Rule` | `categoryFilters` | Deprecated |
| `ColdEmail` | (entire model) | Being migrated to GroupItem |

**Impact:** Database bloat, confusion for developers.

**Fix:** 
1. Ensure migration is complete
2. Create migration to drop deprecated columns
3. Remove from schema

---

## Low Priority Issues

### 13. [KNOWN ISSUE] Directory Structure Overlap

**Status:** ⚠️ Known Issue / Deferred.

**Issue:** `utils/actions/` and `services/unsubscriber/` have overlapping responsibilities.

**Files in both directories:**
- permissions.ts
- cold-email.validation.ts
- report.ts
- And likely others

**Fix:** Consolidate into `services/` with clear domain separation.

---

### 14. [KNOWN ISSUE] Default README Not Updated

**Status:** ⚠️ Known Issue / Deferred.

**Location:** `NEXT-README.md`

**Issue:** Still contains default Next.js create-next-app boilerplate.

**Fix:** Replace with actual project documentation (use `docs/03-README-DRAFT.md` as base).

---

### 15. [KNOWN ISSUE] Mixed Import Path Aliases

**Status:** ⚠️ Known Issue / Deferred.

**Issue:** Files use different alias patterns inconsistently.

**Patterns:**
```typescript
// Pattern 1
import { logger } from "@/utils/logger";

// Pattern 2  
import { logger } from "@/server/utils/logger";

// Pattern 3 (integrations)
import { something } from "@/utils/email/types";
```

**Fix:** Standardize path aliases in `tsconfig.json` and enforce via ESLint.

---

### 16. [KNOWN ISSUE] Potential Dead Code

**Status:** ⚠️ Known Issue / Deferred.

**Issue:** After import, some code may be orphaned or unused.

**Areas to check:**
- Old prompt-to-rules implementation (`prompt-to-rules-old.ts`)
- Deprecated cold email handling code
- Test mocks that may not be used

**Fix:** Run dead code analysis tool, remove unused exports.

---

### 17. [KNOWN ISSUE] Test Coverage Gaps

**Status:** ⚠️ Known Issue / Deferred.

**Issue:** Some features lack corresponding tests.

**Observed gaps:**
- Some AI integration files don't have test files
- E2E tests for API routes may be missing

**Fix:** Add test coverage as features are worked on.

---

## Technical Debt

### Debt Summary

| Category | Items | Effort |
|----------|-------|--------|
| Code Duplication | 5 duplicate files | Low |
| Import Inconsistency | 180+ files to update | Medium |
| Deprecated Code | 8+ fields/models | Medium |
| Incomplete Features | 3 TODOs | Medium-High |
| Directory Structure | Reorganization needed | High |

### Debt Priority Matrix

```
                    Impact
                High        Low
            ┌──────────┬──────────┐
    Easy    │ Import   │ README   │
            │ Paths    │ Update   │
Effort      ├──────────┼──────────┤
    Hard    │ Dir      │ Dead     │
            │ Reorg    │ Code     │
            └──────────┴──────────┘
```

**Recommended Order:**
1. Fix duplicate files (easy, high impact)
2. Add missing env var (easy, prevents bugs)
3. Standardize imports (medium effort, high value)
4. Update README (easy)
5. Directory reorganization (hard, do incrementally)

---

## Security Notes

### Positive Findings

- No hardcoded secrets found in source code
- API keys accessed via environment variables
- Encryption setup exists for sensitive data:
  - `EMAIL_ENCRYPT_SECRET` / `EMAIL_ENCRYPT_SALT` for tokens
  - Database encryption for OAuth tokens
  - MCP credentials encrypted

### Areas to Monitor

| Area | Status | Notes |
|------|--------|-------|
| Secret Management | Good | Via env vars |
| OAuth Token Storage | Good | Encrypted in DB |
| API Key Hashing | Good | Hashed before storage |
| Input Validation | Good | Zod schemas used |
| SQL Injection | Good | Prisma ORM prevents |
| XSS Protection | Check | Need to verify in frontend |

### Recommendations

1. **Add security headers** - Ensure Next.js security headers are configured
2. **Rate limiting** - Verify rate limits on AI endpoints
3. **Audit logging** - Ensure sensitive operations are logged
4. **Dependency audit** - Run `bun audit` regularly

---

## Recommended Actions

### Immediate (Before Development)

| # | Action | Priority | Effort |
|---|--------|----------|--------|
| 1 | Add `BRAINTRUST_API_KEY` to `env.ts` | Critical | 5 min |
| 2 | Delete duplicate `permissions.ts` (gmail) | Critical | 15 min |
| 3 | Delete duplicate `permissions.ts` (actions) | Critical | 15 min |
| 4 | Delete duplicate `cold-email.validation.ts` | Critical | 10 min |
| 5 | Merge `report.ts` files | Critical | 30 min |

### Short-term (During Development)

| # | Action | Priority | Effort |
|---|--------|----------|--------|
| 6 | Standardize Prisma imports | High | 2 hours |
| 7 | Fix internalDate type at source | High | 1-2 hours |
| 8 | Implement Outlook permission checks | High | 2-4 hours |
| 9 | Update README with actual content | Medium | 30 min |
| 10 | Add proper error handling in middleware | Medium | 1 hour |

### Long-term (Maintenance)

| # | Action | Priority | Effort |
|---|--------|----------|--------|
| 11 | Reorganize directory structure | Medium | 1-2 days |
| 12 | Remove deprecated schema fields | Medium | 2-4 hours |
| 13 | Implement multi-rule matching | Low | 4-8 hours |
| 14 | Dead code analysis and cleanup | Low | 2-4 hours |
| 15 | Add ESLint import path rules | Low | 1 hour |

---

### 22. [RESOLVED] Strict Type Safety Violations

**Status:** ✅ Resolved.

**Issue:** Widespread use of `: any` and `as any` types, violating project rules.

**Locations detected:**
- `src/server/features/ai/assistant/chat.ts` (Resolved: Added explicit Zod types to tool args).
- `src/server/lib/posthog.ts` (Resolved: Switched to `Record<string, unknown>`).
- `src/server/lib/linking.ts` (Resolved: Switched to narrow types).
- `src/app/api/surfaces/link/route.ts` (Resolved: proper error narrowing).

**Fix Implemented:**
- Enforced `z.infer` for all AI tool arguments.
- Replaced loose record types with unknown-validated records.
- Added strict error handling in API routes.

---

### 23. [RESOLVED] Production Logging in API Routes

**Status:** ✅ Resolved.

**Issue:** `console.log` statements remaining in production API routes.

**Fix Implemented:**
- Replaced all `console.log` and `console.error` with `createScopedLogger("approvals/approve")` in `approve/route.ts`.
- Ensures logs are properly structured and sent to production logging infrastructure (Axiom/Sentry).
- Removed redundant dynamic imports of logger.

---

### 24. [RESOLVED] Unsafe Environment Variable Usage

**Status:** ✅ Resolved.

**Issue:** Direct access to `process.env` bypasses the type-safe `src/env.ts` validation.

**Fix Implemented:**
- Added `JOBS_SHARED_SECRET` to `src/env.ts`.
- Refactored `summarize-conversation/route.ts` to use type-safe `env`.
- Added local `env.ts` (Zod validation) to `tinybird-ai-analytics` package to handle standalone env safety.

---

### 25. [OPEN] Missing Error Handling in Job Routes

**Status:** ⚠️ Known Issue / Deferred.

**Issue:** Async API routes lack top-level `try/catch` blocks.

**Location:** `src/app/api/jobs/summarize-conversation/route.ts`

**Code:**
```typescript
export async function POST(req: Request) {
    // ... logic ...
    const result = await generate({...}); // Can throw
    // ...
}
```

**Impact:** Unhandled exceptions (e.g., AI timeout, DB connection loss) result in 500 errors with no logging or structured response, making debugging difficult.

**Fix:** Wrap logic in `try/catch`, check for `SafeError`, and log unexpected failures.

---

### 26. [OPEN] Flaky Test Practices

**Status:** ⚠️ Known Issue / Deferred.

**Issue:** Tests mutating global state.

**Location:** `src/server/lib/schedule.test.ts`

**Code:**
```typescript
process.env.TZ = "UTC"; // Mutates global process state
```

**Impact:** Can cause other date-related tests to fail unpredictably if run in parallel or the same runner process.

**Fix:** Use `vi.stubEnv` or `beforeEach`/`afterEach` to safely mock environment variables.

---

### 27. [OPEN] Runtime Migration Follow-Up - Drop Legacy `Rule` Table

**Status:** ⚠️ **Open / In Progress**.

**Issue:** OpenClaw runtime/rule-plane migration removed direct `prisma.rule` usage, but the legacy `Rule` model/table remains in schema for compatibility.

**Impact:** Source-of-truth drift risk remains until legacy rule rows are fully backfilled and the table can be safely dropped.

**Fix:** Backfill legacy `Rule` rows to `CanonicalRule` (with version history), switch remaining relation-dependent surfaces, then drop `Rule` in a dedicated migration.

---

### 28. [OPEN] Runtime Migration Follow-Up - Remove Legacy Approval Payload Compatibility

**Status:** ⚠️ **Open / In Progress**.

**Issue:** Approval execution still accepts legacy `capability_execute` payloads for backwards compatibility.

**Impact:** Compatibility code keeps legacy naming and branch paths alive longer than needed, increasing maintenance surface.

**Fix:** Migrate remaining callers to `tool_execute`, remove legacy parser branch from approvals execution, and tighten payload validation.

---

## Issue Tracking Template

When working through these issues, use this template:

```markdown
## Issue: [Name]

**Status:** [ ] Not Started / [ ] In Progress / [x] Resolved
**Priority:** Critical / High / Medium / Low
**Effort:** X hours

**Problem:**
[Description of the issue]

**Root Cause:**
[Why this happened]

**Solution:**
[How it was fixed]

**Files Changed:**
- `path/to/file.ts`

**Testing:**
- [ ] Unit tests pass
- [ ] Manual verification
```
