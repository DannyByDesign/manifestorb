/**
 * Category resolution: map SystemType to Category and get-or-create user categories.
 */
import prisma from "@/server/db/client";

const SYSTEM_TYPE_TO_NAME: Record<string, string> = {
  TO_REPLY: "To Reply",
  FYI: "FYI",
  AWAITING_REPLY: "Awaiting Reply",
  ACTIONED: "Actioned",
  COLD_EMAIL: "Cold Email",
  NEWSLETTER: "Newsletter",
  MARKETING: "Marketing",
  CALENDAR: "Calendar",
  RECEIPT: "Receipt",
  NOTIFICATION: "Notification",
};

/**
 * Resolve a SystemType enum value to a Category id (for transition period).
 */
export async function resolveSystemTypeToCategory(
  userId: string,
  systemType: string,
): Promise<string | null> {
  const name = SYSTEM_TYPE_TO_NAME[systemType];
  if (!name) return null;

  const category = await prisma.category.findUnique({
    where: { userId_name: { userId, name } },
    select: { id: true },
  });
  return category?.id ?? null;
}

/**
 * Get or create a category for a user (for AI-learned or custom categories).
 */
export async function getOrCreateCategory({
  userId,
  name,
  description,
  isLearned = false,
}: {
  userId: string;
  name: string;
  description?: string;
  isLearned?: boolean;
}): Promise<string> {
  const existing = await prisma.category.findUnique({
    where: { userId_name: { userId, name } },
  });
  if (existing) return existing.id;

  const created = await prisma.category.create({
    data: { userId, name, description: description ?? null, isLearned },
  });
  return created.id;
}
