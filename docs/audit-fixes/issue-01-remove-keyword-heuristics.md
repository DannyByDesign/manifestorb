# Issue 01: Remove Hardcoded Keyword Heuristics That Bypass LLM

**Severity:** CRITICAL
**Category:** Interception & Routing Logic

---

## Problem

Two functions in `src/server/features/rules/ai/ai-choose-rule.ts` deterministically select email rules using hardcoded keyword lists and regex patterns, completely bypassing the LLM:

- `pickRuleByKeywords()` (lines 197-235): Checks email content against hardcoded "urgent" and "support" keyword lists, then matches rules by name substring.
- `pickRuleByHeuristics()` (lines 237-449): Contains 15+ regex patterns and keyword lists (emergency, recruiting, cancellation, investor, escalation, timezone, personal, repair, VIP, after-hours, strategic, placeholder) that match emails to rules by name substring.

These functions are called as a **fallback** when the LLM-based `aiChooseRule` times out (3500ms timeout at line 68). But because the timeout is short and these heuristics are comprehensive, they frequently bypass the LLM in production.

### Current Call Flow

```
aiChooseRule() [line 28]
  -> tries LLM-based selection with 3500ms timeout [line 68]
  -> on timeout/failure, falls back to:
     1. pickRuleByKeywords() [line ~85]
     2. pickRuleByHeuristics() [line ~90]
```

### Why This Is Incompatible

The AI assistant should evaluate ALL emails through the LLM against user-defined rules. Hardcoded keywords mean:
- A user's custom rule for "urgent" emails will never be evaluated by the LLM if the email contains the word "urgent"
- The heuristics match rules by **name substring** (e.g., finds a rule whose name contains "support"), which is fragile and user-unfriendly
- Users cannot customize or override these behaviors

---

## Root Cause

The heuristics were added as a performance optimization to avoid LLM latency for "obvious" matches. But they grew to cover so many patterns that they became a shadow routing system.

---

## Step-by-Step Fix

### Step 1: Remove `pickRuleByKeywords` function

**File:** `src/server/features/rules/ai/ai-choose-rule.ts`

Delete the entire function at lines 197-235:

```typescript
// DELETE THIS ENTIRE FUNCTION (lines 197-235)
function pickRuleByKeywords<T extends { name: string }>(
  email: EmailForLLM,
  rules: T[],
): T | null {
  // ... all contents ...
}
```

### Step 2: Remove `pickRuleByHeuristics` function

**File:** `src/server/features/rules/ai/ai-choose-rule.ts`

Delete the entire function at lines 237-449:

```typescript
// DELETE THIS ENTIRE FUNCTION (lines 237-449)
function pickRuleByHeuristics<T extends { name: string }>(
  email: EmailForLLM,
  emailAccount: EmailAccountWithAI,
  rules: T[],
): { rule: T; reason: string } | null {
  // ... all contents ...
}
```

### Step 3: Update the fallback in `aiChooseRule`

**File:** `src/server/features/rules/ai/ai-choose-rule.ts`

Find where `pickRuleByKeywords` and `pickRuleByHeuristics` are called in the main `aiChooseRule` function (the timeout/catch block, approximately lines 80-95). Replace the fallback with a return of empty results:

**Find** the block that looks like:

```typescript
// On timeout or failure, try heuristics
const keywordMatch = pickRuleByKeywords(email, rules);
if (keywordMatch) {
  return { rules: [{ rule: keywordMatch }], reason: "Matched by keyword heuristic" };
}
const heuristicMatch = pickRuleByHeuristics(email, emailAccount, rules);
if (heuristicMatch) {
  return { rules: [{ rule: heuristicMatch.rule }], reason: heuristicMatch.reason };
}
```

**Replace with:**

```typescript
// LLM timed out or failed -- return no match rather than using hardcoded heuristics.
// The email will be re-evaluated on the next processing cycle.
logger.warn("AI rule selection timed out; no fallback heuristics applied", {
  emailId: email.id,
  ruleCount: rules.length,
});
return { rules: [], reason: "AI rule selection timed out" };
```

### Step 4: Increase the timeout (see also Issue 03)

**File:** `src/server/features/rules/ai/ai-choose-rule.ts`, line 68

Change `3500` to `10000` (10 seconds) as a temporary measure to reduce timeouts while Issue 03 (configurable timeout) is implemented:

```typescript
// Before:
3500,
// After:
10_000,
```

### Step 5: Remove unused imports

After deleting the two functions, check for any imports that were only used by them (e.g., `escapeRegExp` if only used in heuristics). Remove unused imports to keep the file clean.

---

## Files to Modify

- `src/server/features/rules/ai/ai-choose-rule.ts` -- delete two functions, update fallback logic, increase timeout

## Files to Create

None.

## Testing Instructions

1. Run existing rule-matching tests:
   ```bash
   bunx vitest run src/server/features/rules/ai/ai-choose-rule.test.ts
   bunx vitest run src/server/features/rules/ai/match-rules.test.ts
   ```
2. If any tests were specifically testing keyword/heuristic matching, they should be updated or removed since those paths no longer exist.
3. Run the E2E test to verify rule matching still works via LLM:
   ```bash
   bunx vitest run src/__tests__/e2e/nothing-else-matters.test.ts
   ```
4. Verify TypeScript compiles: `bunx tsc --noEmit`

## Rollback Plan

Revert the file to its previous state using `git checkout src/server/features/rules/ai/ai-choose-rule.ts`.

## Dependencies on Other Issues

- **Issue 03** (configurable timeout): Should be implemented alongside or shortly after this issue to prevent excessive timeouts from degrading the user experience.
- **Issue 04** (static rule LLM confirmation): Related but independent -- static rules are a separate code path in `match-rules.ts`.
