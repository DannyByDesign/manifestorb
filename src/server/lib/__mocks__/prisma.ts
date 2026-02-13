import { mockDeep, mockReset } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma/client";

const prisma = mockDeep<PrismaClient>();

export const resetPrismaMock = () => {
  mockReset(prisma);
};

export default prisma;
