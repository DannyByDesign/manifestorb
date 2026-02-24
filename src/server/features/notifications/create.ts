import { Prisma } from "@/generated/prisma/client";
import prisma from "@/server/db/client";

export interface CreateInAppNotificationInput {
  userId: string;
  title: string;
  body?: string | null;
  type?: string;
  metadata?: Record<string, unknown> | null;
  dedupeKey?: string | null;
}

function isUniqueDedupeError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function createInAppNotification(input: CreateInAppNotificationInput) {
  const dedupeKey = input.dedupeKey?.trim() || null;
  const data = {
    userId: input.userId,
    title: input.title,
    body: input.body ?? null,
    type: input.type ?? "info",
    metadata: input.metadata ?? undefined,
    dedupeKey,
  };

  if (!dedupeKey) {
    return prisma.inAppNotification.create({ data });
  }

  try {
    return await prisma.inAppNotification.create({ data });
  } catch (error) {
    if (!isUniqueDedupeError(error)) {
      throw error;
    }
    const existing = await prisma.inAppNotification.findUnique({
      where: { dedupeKey },
    });
    if (existing) {
      return existing;
    }
    throw error;
  }
}
