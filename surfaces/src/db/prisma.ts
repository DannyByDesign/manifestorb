/**
 * Prisma Client for Surfaces Sidecar
 * 
 * Connects to the same database as the main app.
 * Uses the shared Prisma schema (symlinked from main app).
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../generated/prisma/client";
import { env } from "../env";

// Create a singleton instance
const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString: env.DATABASE_URL ?? "",
    }),
  });

if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prisma;
}

export default prisma;
