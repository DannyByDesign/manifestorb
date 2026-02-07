/**
 * Scan user data for items that need attention (proactive context).
 */
import prisma from "@/server/db/client";
import type { AttentionItem } from "./types";

export async function scanForAttentionItems(
  userId: string,
): Promise<AttentionItem[]> {
  const items: AttentionItem[] = [];
  const now = new Date();

  // 1. Unread inbox emails from last 7 days (proxy for "might need reply")
  try {
    const unread = await prisma.emailMessage.findMany({
      where: {
        emailAccount: { userId },
        inbox: true,
        read: false,
        date: {
          gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
          lte: new Date(now.getTime() - 2 * 60 * 60 * 1000),
        },
      },
      orderBy: { date: "desc" },
      take: 5,
      select: { threadId: true, from: true, date: true },
    });
    for (const email of unread) {
      const hoursOld = Math.round(
        (now.getTime() - email.date.getTime()) / (1000 * 60 * 60),
      );
      items.push({
        id: `unanswered-${email.threadId}`,
        type: "unanswered_email",
        urgency: hoursOld > 24 ? "high" : "medium",
        title: `Unread email from ${email.from}`,
        description: `Received ${hoursOld} hours ago.`,
        actionable: true,
        suggestedAction: "Draft a reply",
        relatedEntityId: email.threadId,
        relatedEntityType: "email",
        detectedAt: now,
      });
    }
  } catch {
    // skip
  }

  // 2. Upcoming meetings in the next 30 minutes (from CalendarActionLog)
  try {
    const logs = await prisma.calendarActionLog.findMany({
      where: {
        userId,
        action: "create",
        createdAt: {
          gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        },
      },
      select: { payload: true, eventId: true },
      take: 20,
    });
    for (const meeting of logs) {
      const payload = meeting.payload as Record<string, unknown> | null;
      if (!payload?.start) continue;
      const start = new Date(payload.start as string);
      const minutesUntil = (start.getTime() - now.getTime()) / (1000 * 60);
      if (minutesUntil > 0 && minutesUntil <= 30) {
        items.push({
          id: `upcoming-${meeting.eventId ?? meeting.payload}`,
          type: "upcoming_meeting",
          urgency: minutesUntil <= 10 ? "high" : "medium",
          title: `Meeting "${(payload.title as string) ?? "Untitled"}" in ${Math.round(minutesUntil)} minutes`,
          description: `Starts at ${start.toLocaleTimeString()}`,
          actionable: false,
          relatedEntityId: (meeting.eventId as string) ?? "",
          relatedEntityType: "calendar",
          detectedAt: now,
        });
      }
    }
  } catch {
    // skip
  }

  // 3. Overdue tasks
  try {
    const overdueTasks = await prisma.task.findMany({
      where: {
        userId,
        status: { in: ["PENDING", "IN_PROGRESS"] },
        dueDate: { lt: now },
      },
      select: { id: true, title: true, dueDate: true, priority: true },
      orderBy: { dueDate: "asc" },
      take: 5,
    });
    for (const task of overdueTasks) {
      const daysOverdue = Math.round(
        (now.getTime() - (task.dueDate?.getTime() ?? 0)) /
          (1000 * 60 * 60 * 24),
      );
      items.push({
        id: `overdue-${task.id}`,
        type: "overdue_task",
        urgency:
          daysOverdue > 3 || task.priority === "HIGH" ? "high" : "medium",
        title: `Overdue: "${task.title}"`,
        description: `Due ${daysOverdue} day(s) ago.`,
        actionable: true,
        suggestedAction: "Reschedule or complete",
        relatedEntityId: task.id,
        relatedEntityType: "task",
        detectedAt: now,
      });
    }
  } catch {
    // skip
  }

  // 4. Approvals expiring in the next hour
  try {
    const expiring = await prisma.approvalRequest.findMany({
      where: {
        userId,
        status: "PENDING",
        expiresAt: {
          gt: now,
          lt: new Date(now.getTime() + 60 * 60 * 1000),
        },
      },
      select: { id: true, requestPayload: true, expiresAt: true },
      take: 5,
    });
    for (const approval of expiring) {
      const payload = approval.requestPayload as Record<string, unknown>;
      const minutesLeft = Math.round(
        (approval.expiresAt.getTime() - now.getTime()) / (1000 * 60),
      );
      items.push({
        id: `expiring-${approval.id}`,
        type: "pending_approval",
        urgency: minutesLeft < 15 ? "high" : "medium",
        title: `Approval expiring: "${(payload.description as string) ?? "Action pending"}"`,
        description: `Expires in ${minutesLeft} minutes.`,
        actionable: true,
        suggestedAction: "Approve or deny",
        relatedEntityId: approval.id,
        relatedEntityType: "approval",
        detectedAt: now,
      });
    }
  } catch {
    // skip
  }

  const urgencyOrder = { high: 0, medium: 1, low: 2 };
  items.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);
  return items;
}
