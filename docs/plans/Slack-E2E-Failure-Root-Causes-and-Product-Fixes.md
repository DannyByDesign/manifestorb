# Slack E2E Failures: Root Causes, Product Fixes, and Test Fixes

This document expands on the five failing Slack E2E tests with **product-side fixes** (not just test changes), and gives concrete steps to fix the generic "I encountered an error processing your request" response.

---

## 1. "I encountered an error processing your request" (Simulated round-trip and any agent failure)

### Problem
When the agent (or anything in the inbound pipeline) throws, the user only sees a generic message. The real error is logged but never surfaced, so debugging and UX are poor.

### Root cause
In [src/server/features/channels/router.ts](src/server/features/channels/router.ts) (lines 306–311), the catch block always returns the same string:

```ts
} catch (error) {
    logger.error("Error running agent", { error });
    return [{
        targetChannelId: message.context.channelId,
        content: "I encountered an error processing your request."
    }];
}
```

Exceptions can come from:
- **Executor:** `accountRow?.account` null → `processMessage` gets `account: undefined` → `resolvedProvider` is `""` → [createEmailProvider](src/server/features/email/provider.ts) throws `Unsupported provider: `.
- **Message processor / tools:** Missing env, rate limits, Gmail/Calendar API errors, etc.

### Product fixes (in order of impact)

**1.1 Surface a safe error message to the user (product + ops)**

- In the router catch block, derive a **user-facing** message from the error instead of a single generic string.
- Use existing [getErrorMessage](src/server/lib/error.ts) (or equivalent) to get a string from `error`. Then:
  - **Production:** If the error is "safe" (e.g. known validation or auth messages), return that message; otherwise return a generic but actionable line, e.g. "Something went wrong. Please try again or contact support."
  - **Non-production (e.g. `NODE_ENV !== "production"` or `E2E_VERBOSE_ERRORS=true`):** Append or replace with the actual error message so E2E and dev see the real cause (e.g. "Unsupported provider: " or "Email account not found").
- Keep `logger.error("Error running agent", { error })` (and consider logging `error.stack`) so the full error is always in logs.

**1.2 Harden executor so provider is never empty (product)**

- In [src/server/features/channels/executor.ts](src/server/features/channels/executor.ts), after loading `accountRow`, if `accountRow?.account?.provider` is missing:
  - **Option A:** Return a structured result (or throw a known error) that the router can turn into a user message, e.g. "Your email account isn't fully connected. Please connect Gmail or Outlook in the Amodel app."
  - **Option B:** Throw an error with a clear message (e.g. "Email account has no OAuth provider") so that when we implement 1.1, the user sees that instead of "Unsupported provider: ".
- This prevents `createAgentTools` from ever being called with `provider: ""`, which eliminates one major class of "error processing your request" in E2E and production.

**1.3 Validate inbound context earlier (product)**

- In the router, after resolving `emailAccount`, optionally check that the email account has a linked OAuth account (e.g. by doing the same `findUnique` the executor does, or by ensuring the included `account` relation is present). If not, return a clear message: "Please connect your email (Gmail or Outlook) in the Amodel app to use this." instead of sending the request into the agent and failing later.

**1.4 Test fix (simulated round-trip)**

- Ensure the simulated test uses a linked Slack user whose email account has an OAuth provider set (same as full E2E). Document this in the E2E README.
- Once 1.1 is in place, the test can assert on the actual error message in dev/E2E when something is misconfigured, making failures easier to diagnose.

---

## 2. Proactive message (URGENT in Slack)

### Problem
Test expects a Slack message containing "URGENT" or "Server down" but never sends an email; the product may not push to Slack on new/urgent email.

### Product fix (if we want this feature)

- **Define behavior:** When should the app push to Slack? (e.g. new email that matches "urgent" rule, or every new email in inbox.)
- **Implement flow:** From the Gmail history/webhook path (e.g. [process-history-item](src/app/api/google/webhook/process-history-item.ts) or the code that processes new messages), after determining the user and that the email is "urgent" (or should notify):
  - Resolve the user's active Slack (or surface) conversation (e.g. via existing conversation/channel resolution).
  - Call [ChannelRouter.pushMessage](src/server/features/channels/router.ts) with a short, safe summary (e.g. "New urgent email from X: subject Y"). Reuse the same push path used for approval/fallback notifications.
- **Security and privacy:** Do not include full body or sensitive content; keep to sender and subject/snippet.

### Test fix

- If the feature does not exist: **skip** the test with a comment that "push to Slack on urgent email" is not implemented.
- If the feature is implemented: **implement** the test (send inbound email with e.g. subject "[URGENT] Server down", wait, then assert on channel history for a message containing "URGENT" or the subject).

---

## 3. Gmail read (Bob email / proposal)

### Problem
- Test asserts on the concatenation of **all** bot messages in the channel instead of the single reply to "Did Bob email me…".
- The actual reply is often an error ("I was unable to search your emails…"), so email search is failing in this context.

### Product fixes (email search)

- **Improve error message to the user:** We already improved tool error surfacing (getErrorMessage, Gmail search wrapper). Ensure the model receives and relays a clear, non-generic message (e.g. "I couldn't search your inbox right now. Please check that Gmail is connected and try again.") when the query tool returns an error. Avoid "unknown error" in the final reply.
- **Diagnose Gmail search failure:** Use logs (and, if 1.1 is done, the surfaced error in E2E) to see why search fails (e.g. scope, token expiry, or query format). Fix scopes or token refresh so that "from:bob" (or equivalent) works for the linked account in E2E.
- **Optional:** In E2E, ensure test data exists (e.g. an email from bob@example.com with "proposal" in subject/body) so that when search succeeds, the assertion on content can pass.

### Test fix

- After `waitForSlackChannelResponse`, take **only the reply** to this user message: among messages with `m.bot_id && m.ts > msg.ts`, sort by `ts` ascending and take the first; use that message’s `text` for the assertion. This avoids mixing in other tests’ turns and makes the test stable and correct.

---

## 4. Calendar event creation (deep work block)

### Problem
Bot says it created the block, but `listCalendarEvents(ctx, timeMin, timeMax, "deep work")` returns 0 events.

### Product fixes

- **Use a consistent calendar for the same user:** The AI’s calendar create flow uses [getProviderFor(calendarId)](src/server/features/ai/tools/providers/calendar.ts) (task preferences or first enabled calendar). Ensure that for a given user/email account, the same calendar is used for creation and for the test’s `ctx` (e.g. both use the first enabled calendar, or both respect the same preference). This may require passing through a preferred calendar from the user’s settings so the AI and the test harness align.
- **Timezone alignment:** Ensure the created event’s start/end are stored and queried in the same timezone (or that the test’s `timeMin`/`timeMax` match the calendar API’s range). If the AI uses the user’s timezone from preferences, the test should use the same (e.g. `LIVE_GOOGLE_TIME_ZONE`) when building `timeMin`/`timeMax`.
- **Return identifiers when possible:** When the create tool succeeds, consider returning calendar ID and event ID (or at least logging them) so E2E can verify the right calendar and event.

### Test fix

- First call `listCalendarEvents(ctx, timeMin, timeMax)` **without** the title filter. If the result is empty, fail with a clear message (e.g. "No events in range; check calendar and timezone"). If any events exist, filter by title "deep work" in the test and assert at least one matches. This distinguishes "no events at all" from "events exist but title doesn’t match."

---

## 5. Email → Slack notification (new email push)

### Problem
Test expects a Slack message about "client@bigco.com" and "meeting" after sending an email. No such flow exists in the product.

### Product fix (new email → Slack/surface notification)

- **Define behavior:** When should we notify the user on Slack (or another surface)? Options: every new email, only when rules label it important, or only for certain senders.
- **Implement flow:**
  - In the path that processes new mail (e.g. Gmail history or webhook handler), after associating the message with a user and optional rules/labels:
    - Resolve the user’s active Slack (or surface) conversation (reuse the same mechanism as other pushes).
    - Build a short, safe notification string (e.g. "New email from client@bigco.com: Meeting Request").
    - Call `ChannelRouter.pushMessage(userId, content)` (or the same API used for approval/fallback).
  - Respect user preferences if we add "notify me on Slack for new email" later.
- **Privacy:** Do not include full body; keep to sender and subject/snippet.

### Test fix

- **Short term:** Skip the test with a comment that "email-to-Slack notification on new email" is not implemented.
- **After feature exists:** Re-enable the test: send email, wait, fetch channel history, assert one message contains the sender and a keyword (e.g. "meeting").

---

## Summary: Product vs test effort

| # | Area | Product effort | Test effort |
|---|------|----------------|-------------|
| 1 | Error processing your request | Surface safe/verbose error (1.1), harden executor provider (1.2), optional early validation (1.3) | Document link/provider requirement; assert on real error when 1.1 is on |
| 2 | Proactive URGENT | Implement "urgent email → pushMessage" and define when to push | Skip until feature exists; then implement send-email + assert |
| 3 | Gmail read | Clear user-facing error message; fix Gmail scope/token/query so search works | Assert on single reply (ts > msg.ts) only |
| 4 | Calendar creation | Align calendar ID and timezone for AI and verification; optional return event/calendar ID | Assert without title filter first; then filter by title |
| 5 | Email → Slack notification | Implement "new email → pushMessage" and define when to push | Skip until feature exists; then re-enable and assert |

Implementing **1.1** and **1.2** addresses the generic "error processing your request" and removes a major source of opaque failures in both production and E2E.
