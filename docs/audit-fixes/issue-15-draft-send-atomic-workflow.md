# Issue 15: Combine Draft/Send into Single Approval Workflow

**Severity:** HIGH
**Category:** Workflow Fragmentation

---

## Problem

Drafting and sending an email are separate multi-step workflows requiring explicit user transitions:

1. User asks AI to draft an email
2. AI creates a draft (no approval needed -- `executor.ts` line 66: "drafts don't need approval")
3. User reviews draft somewhere
4. User explicitly asks AI to send the draft
5. The `send` tool is intercepted for approval (`sensitiveTools = ["modify", "delete", "send"]`)
6. User approves

This is 4 interactions for a single email. The SCHEDULE_MEETING action we built demonstrates the correct pattern: AI drafts + presents for approval in a single notification.

---

## Root Cause

The draft and send operations were designed as independent tool calls. No "draft-and-send-when-approved" atomic operation exists.

---

## Step-by-Step Fix

### Step 1: Add a `draftAndSend` mode to the create tool

**File:** `src/server/features/ai/tools/create.ts`

In the `data` parameter schema, add an optional field:

```typescript
// In the createParameters z.object, under the email section:
sendOnApproval: z.boolean().optional().describe("If true, creates a draft and sends an approval notification. When user approves, the draft is sent automatically. Use this for all email drafts unless the user explicitly says 'just save as draft'."),
```

### Step 2: Implement the draft-and-send logic in the email case

**File:** `src/server/features/ai/tools/create.ts`

Find the `case "email"` in the execute function. After the existing draft creation logic, add the approval flow:

```typescript
case "email": {
  // ... existing draft creation logic that creates `draftResult` ...

  if (data.sendOnApproval && draftResult?.id) {
    // Create an approval request to send this draft
    const approvalService = new ApprovalService(prisma);
    const { createHash } = await import("crypto");

    const idempotencyKey = createHash("sha256")
      .update(`send-draft:${context.userId}:${draftResult.id}:${Date.now()}`)
      .digest("hex");

    const approval = await approvalService.createRequest({
      userId: context.userId,
      provider: "system",
      externalContext: { source: "draft_and_send" },
      requestPayload: {
        actionType: "send_draft",
        description: `Send email to ${data.to?.join(", ")} re: ${data.subject}`,
        tool: "send",
        args: { draftId: draftResult.id },
        draftId: draftResult.id,
        draftContent: data.body,
        recipients: data.to,
        subject: data.subject,
      },
      idempotencyKey,
      expiresInSeconds: 86_400, // 24 hours
    });

    // Create rich notification with draft preview
    const { createInAppNotification } = await import("@/features/notifications/create");
    await createInAppNotification({
      userId: context.userId,
      title: `Draft ready: ${data.subject || "(No subject)"}`,
      body: `To: ${data.to?.join(", ")}. Approve to send.`,
      type: "approval",
      metadata: {
        approvalId: approval.id,
        draftId: draftResult.id,
        to: data.to,
        subject: data.subject,
        bodyPreview: (data.body || "").substring(0, 300),
      },
      dedupeKey: `draft-send-${approval.id}`,
    });

    return {
      success: true,
      data: {
        draftId: draftResult.id,
        approvalId: approval.id,
        status: "draft_pending_approval",
      },
      message: `Draft created and ready for your approval. You'll see a notification to review and send.`,
    };
  }

  // ... existing return for plain draft creation ...
}
```

### Step 3: Handle the `send_draft` approval resolution

**File:** `src/server/features/approvals/execute.ts` (or wherever approval execution happens)

Add a handler for the `send_draft` action type:

```typescript
case "send_draft": {
  const draftId = payload.draftId as string;
  const emailAccountId = payload.emailAccountId as string;

  const emailProvider = await createEmailProvider(emailAccountId);
  await emailProvider.sendDraft(draftId);

  return { success: true, message: "Email sent." };
}
```

### Step 4: Update system prompt to prefer draft-and-send

**File:** `src/server/features/ai/system-prompt.ts`

Find the email drafting section and update:

```typescript
## Email Drafting
When composing an email, always use sendOnApproval: true unless the user explicitly says "just save as draft" or "don't send yet". This creates a draft and presents it for one-tap approval. The user sees the draft preview in a notification and can approve to send immediately.
```

### Step 5: Update the sensitive tool wrapper to skip interception for draft-and-send

Since the `create` tool now handles the approval flow internally for `sendOnApproval`, ensure the existing `send` tool interception in the sensitive tools wrapper doesn't double-intercept.

**File:** `src/server/features/channels/executor.ts`

In the sensitive tool wrapper (around line 75), check if the tool call is a draft-and-send that already has approval:

```typescript
execute: async (args: any) => {
  // If this is resolving an already-approved draft, skip re-approval
  if (args.approvalId && args.preApproved) {
    return originalTool.execute(args);
  }
  // ... existing approval interception logic ...
}
```

---

## Files to Modify

- `src/server/features/ai/tools/create.ts` -- add `sendOnApproval` parameter and logic
- `src/server/features/approvals/execute.ts` -- add `send_draft` handler
- `src/server/features/ai/system-prompt.ts` -- update email drafting guidance
- `src/server/features/channels/executor.ts` -- prevent double-interception

## Files to Create

None.

## Testing Instructions

1. Verify TypeScript compiles: `bunx tsc --noEmit`
2. Test via AI: "draft an email to john@example.com saying I'll be late"
3. Verify a draft is created AND an approval notification appears
4. Approve the notification and verify the email is sent
5. Test "save a draft to john@example.com" (should NOT trigger approval)

## Rollback Plan

Revert modified files. The existing separate draft/send workflow continues to work.

## Dependencies on Other Issues

- **Issue 16** (configurable approvals): The draft-and-send approval should respect user preferences (e.g., "auto-send to internal contacts").
- **Issue 17** (unify pipelines): The approval logic should be in the unified pipeline, not duplicated.
