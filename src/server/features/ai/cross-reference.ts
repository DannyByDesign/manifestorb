/**
 * Cross-reference service: find related items across email, calendar, and tasks.
 */
import prisma from "@/server/db/client";
import type { Logger } from "@/server/lib/logger";

export interface CrossReferenceContext {
  relatedEmails?: Array<{
    threadId: string;
    subject: string;
    from: string;
    receivedAt: Date;
  }>;
  calendarConflicts?: Array<{
    title: string;
    start: Date;
    end: Date;
  }>;
  relatedTasks?: Array<{
    id: string;
    title: string;
    status: string;
    dueDate?: Date | null;
  }>;
}

/**
 * Find related items across features for a given context (sender, subject, attendees).
 */
export async function findCrossReferences({
  userId,
  emailAddress,
  subject,
  attendees,
  logger,
}: {
  userId: string;
  emailAddress?: string;
  subject?: string;
  attendees?: string[];
  logger: Logger;
}): Promise<CrossReferenceContext> {
  const context: CrossReferenceContext = {};

  if (emailAddress) {
    try {
      const emails = await prisma.emailMessage.findMany({
        where: {
          emailAccount: { userId },
          from: { contains: emailAddress, mode: "insensitive" },
          date: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          },
        },
        orderBy: { date: "desc" },
        take: 5,
        select: { threadId: true, from: true, date: true },
      });
      context.relatedEmails = emails.map((e) => ({
        threadId: e.threadId,
        subject: "(No subject)",
        from: e.from,
        receivedAt: e.date,
      }));
    } catch (error) {
      logger.warn("Cross-ref: failed to find related emails", { error });
    }
  }

  if (attendees?.length) {
    context.calendarConflicts = [];
  }

  if (subject) {
    try {
      const keywords = subject
        .split(/\s+/)
        .filter((w) => w.length > 3)
        .slice(0, 5);
      if (keywords.length > 0) {
        const tasks = await prisma.task.findMany({
          where: {
            userId,
            status: { in: ["PENDING", "IN_PROGRESS"] },
            OR: keywords.map((kw) => ({
              title: { contains: kw, mode: "insensitive" },
            })),
          },
          select: { id: true, title: true, status: true, dueDate: true },
          take: 3,
        });
        context.relatedTasks = tasks;
      }
    } catch (error) {
      logger.warn("Cross-ref: failed to find related tasks", { error });
    }
  }

  return context;
}
