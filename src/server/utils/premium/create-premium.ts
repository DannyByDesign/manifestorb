import prisma from "@/server/db/client";

export async function createPremiumForUser({ userId }: { userId: string }) {
  return await prisma.premium.create({
    data: {
      users: { connect: { id: userId } },
      admins: { connect: { id: userId } },
    },
  });
}
