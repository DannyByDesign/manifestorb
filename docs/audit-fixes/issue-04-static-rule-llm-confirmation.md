# Issue 04: Add LLM Confirmation for Static Rule Matches

**Severity:** MEDIUM
**Category:** Interception & Routing Logic

---

## Problem

In `src/server/features/rules/ai/match-rules.ts`, the `matchesStaticRule()` function (lines 454-509) uses regex matching on `from`, `to`, `subject`, and `body` fields. When a static rule matches and the `conditionalOperator` is `OR`, the LLM is never consulted (lines 278-282 in `evaluateRuleConditions`):

```typescript
// evaluateRuleConditions, lines 278-282
if (operator === LogicalOperator.OR) {
  if (staticMatch) {
    // Found a match, no need for AI  <-- THIS IS THE PROBLEM
    return { matched: true, potentialAiMatch: false, matchReasons };
  }
```

This means a static `from` filter like `*@example.com` will auto-match without the LLM evaluating whether the email's **content** actually warrants the rule's action.

---

## Root Cause

The OR logic short-circuits: if the static condition matches, it skips AI evaluation entirely. This was designed for performance but prevents the LLM from applying judgment.

---

## Step-by-Step Fix

### Step 1: Change OR logic to always include AI evaluation

**File:** `src/server/features/rules/ai/match-rules.ts`

Find the `evaluateRuleConditions` function (around line 255). Locate the OR branch (around line 278):

```typescript
if (operator === LogicalOperator.OR) {
  if (staticMatch) {
    return { matched: true, potentialAiMatch: false, matchReasons };
  }
  if (hasAiCondition) {
    return { matched: false, potentialAiMatch: true, matchReasons };
  }
  return { matched: false, potentialAiMatch: false, matchReasons };
}
```

**Replace the OR branch with:**

```typescript
if (operator === LogicalOperator.OR) {
  if (staticMatch && hasAiCondition) {
    // Static matched, but still let AI confirm intent
    return { matched: false, potentialAiMatch: true, matchReasons };
  }
  if (staticMatch) {
    // No AI condition defined -- static match is sufficient
    return { matched: true, potentialAiMatch: false, matchReasons };
  }
  if (hasAiCondition) {
    return { matched: false, potentialAiMatch: true, matchReasons };
  }
  return { matched: false, potentialAiMatch: false, matchReasons };
}
```

This change means:
- If the rule has BOTH static and AI conditions with OR operator, and static matches, the AI still evaluates to confirm.
- If the rule has ONLY a static condition (no AI condition), the static match is final (no change).
- If the rule has ONLY an AI condition, behavior is unchanged.

### Step 2: Pass static match context to the AI

When the AI is called to confirm a static match, it should know that the static condition already matched. This provides useful context.

**File:** `src/server/features/rules/ai/match-rules.ts`

In the `findMatchingRulesWithReasons` function, where potential AI matches are collected and sent to `aiChooseRule`, add a hint in the prompt data:

Find where `potentialAiMatches` are assembled (around lines 389-395):

```typescript
if (potentialAiMatches.length) {
  const fullResult = await aiChooseRule({
    email: getEmailForLLM(message),
    rules: potentialAiMatches,
    emailAccount,
    modelType,
  });
```

Add a `staticMatchHints` field to give the LLM context:

```typescript
if (potentialAiMatches.length) {
  // Build hints for rules that already matched statically
  const staticMatchHints = potentialAiMatches
    .filter(rule => {
      const eval = evaluateRuleConditions({ rule, message, logger });
      return eval.matchReasons.some(r => r.type === ConditionType.STATIC);
    })
    .map(rule => rule.name);

  const fullResult = await aiChooseRule({
    email: getEmailForLLM(message),
    rules: potentialAiMatches,
    emailAccount,
    modelType,
    staticMatchHints, // NEW: tells the AI which rules already matched by static filter
  });
```

### Step 3: Update `aiChooseRule` to accept static match hints

**File:** `src/server/features/rules/ai/ai-choose-rule.ts`

Add `staticMatchHints?: string[]` to the function parameters:

```typescript
export async function aiChooseRule<
  T extends { name: string; instructions: string; systemType?: string | null },
>({
  email,
  rules,
  emailAccount,
  modelType,
  staticMatchHints,  // NEW
}: {
  email: EmailForLLM;
  rules: T[];
  emailAccount: EmailAccountWithAI;
  modelType?: ModelType;
  staticMatchHints?: string[];  // NEW
}): Promise<{
  rules: { rule: T; isPrimary?: boolean }[];
  reason: string;
}> {
```

Then include the hints in the system prompt sent to the LLM:

```typescript
const staticHintBlock = staticMatchHints?.length
  ? `\nNote: The following rules already matched by sender/subject filter: ${staticMatchHints.join(", ")}. Confirm whether the email content warrants these rules' actions.\n`
  : "";
```

Insert `staticHintBlock` into the system prompt string.

---

## Files to Modify

- `src/server/features/rules/ai/match-rules.ts` -- change OR logic in `evaluateRuleConditions`, pass static hints
- `src/server/features/rules/ai/ai-choose-rule.ts` -- accept and use `staticMatchHints` parameter

## Files to Create

None.

## Testing Instructions

1. Run rule matching tests:
   ```bash
   bunx vitest run src/server/features/rules/ai/match-rules.test.ts
   bunx vitest run src/server/features/rules/ai/ai-choose-rule.test.ts
   ```
2. Create a test case where a rule has both a static `from` condition and an AI `instructions` condition with OR operator. Send an email that matches `from` but whose content does NOT match the instructions. Verify the LLM correctly rejects the rule despite the static match.
3. Verify TypeScript compiles: `bunx tsc --noEmit`

## Rollback Plan

Revert both files via git.

## Dependencies on Other Issues

- **Issue 01** (remove heuristics): Independent but complementary. Issue 01 removes the keyword fallback; this issue ensures static rules also get LLM review.
