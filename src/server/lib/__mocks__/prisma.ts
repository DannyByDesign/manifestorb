import { vi } from "vitest";

const prisma = {
  group: {
    findMany: vi.fn(),
  },
  rule: {
    findUniqueOrThrow: vi.fn(),
  },
  executedRule: {
    findMany: vi.fn(),
  },
};

export default prisma;
