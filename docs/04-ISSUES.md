# Codebase Issues & Problems

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

**Location:** `src/server/utils/braintrust.ts` (line ~11)

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
- `src/server/utils/gmail/permissions.ts` (DELETED)
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
- `src/server/utils/actions/permissions.ts` (DELETED)
- `src/server/services/unsubscriber/permissions.ts` (KEPT)

**Code:** 83 lines, identical functionality.

**Fix:** Keep `services/unsubscriber/permissions.ts`, delete the other, update imports.

---

### 4. [RESOLVED] Code Duplication - cold-email.validation.ts

**Status:** ✅ Resolved. Consolidated to `services/unsubscriber/`.

**Issue:** Identical validation schema in two locations.

**Locations:**
- `src/server/utils/actions/cold-email.validation.ts` (DELETED)
- `src/server/services/unsubscriber/cold-email.validation.ts` (KEPT)

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
- `src/server/utils/actions/report.ts` (DELETED)
- `src/server/services/unsubscriber/report.ts` (KEPT)

**Both have TODO:**
```typescript
// TODO: should be able to import this functionality from elsewhere
```

**Fix:** Extract `fetchGmailLabels` to a shared utility, import in both places.

---

### 6. [KNOWN ISSUE] Import Path Inconsistency

**Status:** ⚠️ Known Issue / Deferred.

**Issue:** Prisma client is imported from multiple paths inconsistently.

**Patterns found:**

| Pattern | Files Using |
|---------|-------------|
| `@/utils/prisma` | 133+ files |
| `@/server/db/client` | 48+ files |
| `@/server/utils/prisma` | Some files |

**Impact:** Confusing codebase, potential for accidentally creating multiple Prisma instances.

**Fix:** Standardize on one import path:
```typescript
// Canonical import
import { prisma } from "@/server/db/client";

// Create re-export for backward compatibility
// src/server/utils/prisma.ts
export { prisma } from "@/server/db/client";
```

---

## Medium Priority Issues

### 7. [KNOWN ISSUE] Incomplete Feature - Multiple Rule Matching

**Status:** ⚠️ Known Issue / Deferred.

**Location:** `src/server/utils/assistant/process-assistant-email.ts` (line ~210)

**Code:**
```typescript
// TODO: support multiple rule matching
// Currently only uses first matched rule
```

**Impact:** Users with `multiRuleSelectionEnabled` may not get expected behavior.

**Fix:** Implement full multi-rule support or document limitation.

---

### 8. [KNOWN ISSUE] Incomplete Feature - Outlook Permissions

**Status:** ⚠️ Known Issue / Deferred.

**Location:** 
- `src/server/utils/actions/permissions.ts` (line ~15)
- `src/server/services/unsubscriber/permissions.ts` (line ~15)

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
- `src/server/utils/gmail/permissions.ts` (line ~11)
- `src/server/integrations/google/permissions.ts` (line ~11)

**Code:**
```typescript
// TODO: this can also error on network error
```

**Impact:** Network errors may not be handled gracefully.

**Fix:** Add proper try-catch with network error handling.

---

### 10. [KNOWN ISSUE] Incomplete Error Handling - Middleware

**Status:** ⚠️ Known Issue / Deferred.

**Location:** `src/server/utils/middleware.ts` (line ~165)

**Code:**
```typescript
// Quick fix: log full error in development. TODO: handle properly
```

**Impact:** Production error handling may not be optimal.

**Fix:** Implement proper error logging and response handling.

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
