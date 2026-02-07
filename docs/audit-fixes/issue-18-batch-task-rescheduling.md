# Issue 18: Batch Task Rescheduling Approvals

**Severity:** MEDIUM
**Category:** Workflow Fragmentation

---

## Problem

In `src/server/features/calendar/scheduling/TaskSchedulingService.ts` (lines 294-334), the `createRescheduleApprovals` function creates a **separate** approval request for each task that needs rescheduling:

```typescript
async function createRescheduleApprovals({
  tasks,
  userId,
}: {
  tasks: Array<{ id: string; title: string; scheduledStart: Date | null; scheduledEnd: Date | null }>;
  userId: string;
}) {
  const approvalService = new ApprovalService(prisma);

  await Promise.all(
    tasks.map((task) => {
      // Creates ONE approval per task
      return approvalService.createRequest({
        userId,
        provider: "system",
        requestPayload: {
          actionType: "reschedule_task",
          description: `Approve rescheduling task "${task.title}"`,
          args: { taskId: task.id },
        },
        // ...
      });
    }),
  );
}
```

If 5 tasks need rescheduling, the user gets 5 separate approval notifications and must approve each one individually. This is the opposite of the "single-interaction" pattern the AI assistant should use.

---

## Root Cause

Each task reschedule was treated as an independent approval. No batch operation pattern existed.

---

## Step-by-Step Fix

### Step 1: Create a batch reschedule approval

**File:** `src/server/features/calendar/scheduling/TaskSchedulingService.ts`

Replace the `createRescheduleApprovals` function (lines 294-334) with a batch version:

```typescript
async function createRescheduleApprovals({
  tasks,
  userId,
}: {
  tasks: Array<{
    id: string;
    title: string;
    scheduledStart: Date | null;
    scheduledEnd: Date | null;
    newStart?: Date;
    newEnd?: Date;
  }>;
  userId: string;
}) {
  if (!tasks.length) return;

  const approvalService = new ApprovalService(prisma);
  const { createHash } = await import("crypto");

  // Build a summary of all changes
  const taskSummaries = tasks.map((task, i) => ({
    index: i,
    taskId: task.id,
    title: task.title,
    currentStart: task.scheduledStart?.toISOString() ?? null,
    currentEnd: task.scheduledEnd?.toISOString() ?? null,
    newStart: task.newStart?.toISOString() ?? null,
    newEnd: task.newEnd?.toISOString() ?? null,
  }));

  // Single idempotency key for the batch
  const batchKey = createHash("sha256")
    .update(`reschedule-batch:${userId}:${tasks.map(t => t.id).sort().join(",")}:${Date.now()}`)
    .digest("hex");

  // Create ONE approval request for the entire batch
  const approval = await approvalService.createRequest({
    userId,
    provider: "system",
    externalContext: { source: "task-scheduler" },
    requestPayload: {
      actionType: "batch_reschedule_tasks",
      description: `Reschedule ${tasks.length} task(s)`,
      tasks: taskSummaries,
    },
    idempotencyKey: batchKey,
  });

  // Create ONE notification summarizing all changes
  const { createInAppNotification } = await import("@/features/notifications/create");

  const taskList = tasks
    .map((t) => {
      const newTime = t.newStart
        ? new Date(t.newStart).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
        : "TBD";
      return `- ${t.title} -> ${newTime}`;
    })
    .join("\n");

  await createInAppNotification({
    userId,
    title: `Reschedule ${tasks.length} task(s)?`,
    body: `The scheduler wants to move:\n${taskList}\n\nApprove all or deny.`,
    type: "approval",
    metadata: {
      approvalId: approval.id,
      taskCount: tasks.length,
      tasks: taskSummaries,
    },
    dedupeKey: `batch-reschedule-${approval.id}`,
  });
}
```

### Step 2: Handle batch reschedule approval resolution

**File:** `src/server/features/approvals/execute.ts` (or wherever approvals are resolved)

Add a handler for `batch_reschedule_tasks`:

```typescript
case "batch_reschedule_tasks": {
  const tasks = payload.tasks as Array<{
    taskId: string;
    newStart: string | null;
    newEnd: string | null;
  }>;

  const results = await Promise.all(
    tasks.map(async (t) => {
      try {
        await prisma.task.update({
          where: { id: t.taskId },
          data: {
            scheduledStart: t.newStart ? new Date(t.newStart) : undefined,
            scheduledEnd: t.newEnd ? new Date(t.newEnd) : undefined,
            lastScheduled: new Date(),
          },
        });
        return { taskId: t.taskId, success: true };
      } catch (error) {
        return { taskId: t.taskId, success: false, error: String(error) };
      }
    }),
  );

  const succeeded = results.filter(r => r.success).length;
  return {
    success: succeeded === results.length,
    message: `Rescheduled ${succeeded}/${results.length} tasks.`,
    details: results,
  };
}
```

### Step 3: Pass new times to the approval function

**File:** `src/server/features/calendar/scheduling/TaskSchedulingService.ts`

Find where `createRescheduleApprovals` is called. Ensure the caller passes the proposed new start/end times so they appear in the approval notification:

```typescript
// Find the call site -- it should look something like:
await createRescheduleApprovals({
  tasks: tasksNeedingReschedule.map(task => ({
    ...task,
    newStart: proposedNewSlots.get(task.id)?.start,
    newEnd: proposedNewSlots.get(task.id)?.end,
  })),
  userId,
});
```

---

## Files to Modify

- `src/server/features/calendar/scheduling/TaskSchedulingService.ts` -- replace per-task approval with batch
- `src/server/features/approvals/execute.ts` -- add batch reschedule handler

## Files to Create

None.

## Testing Instructions

1. Verify TypeScript compiles: `bunx tsc --noEmit`
2. Run scheduling tests: `bunx vitest run src/server/features/calendar/scheduling/`
3. Create 3 tasks, trigger a reschedule, and verify only 1 approval notification is created
4. Approve the batch and verify all 3 tasks are updated

## Rollback Plan

Revert the modified files. Per-task approval still works.

## Dependencies on Other Issues

- **Issue 16** (configurable approvals): Users might want to configure whether rescheduling requires approval at all.
