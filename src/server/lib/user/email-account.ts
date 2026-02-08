import prisma from "@/server/db/client";
import type { Prisma } from "@/generated/prisma/client";

export type UserEmailAccountWithProvider = Prisma.EmailAccountGetPayload<{
  include: { account: true };
}>;

export async function findUserEmailAccountWithProvider({
  userId,
  emailAccountId,
  requireConnected = true,
}: {
  userId: string;
  emailAccountId?: string;
  requireConnected?: boolean;
}): Promise<UserEmailAccountWithProvider | null> {
  const where: Prisma.EmailAccountWhereInput = {
    userId,
    ...(emailAccountId ? { id: emailAccountId } : {}),
    ...(requireConnected ? { account: { disconnectedAt: null } } : {}),
  };

  return prisma.emailAccount.findFirst({
    where,
    include: { account: true },
    ...(emailAccountId ? {} : { orderBy: { createdAt: "asc" as const } }),
  });
}
