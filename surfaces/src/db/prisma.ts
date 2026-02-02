/**
 * Prisma Client for Surfaces Sidecar
 * 
 * Connects to the same database as the main app.
 * Uses the shared Prisma schema (symlinked from main app).
 */
import { PrismaClient } from '@prisma/client';

// Create a singleton instance
const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prisma;
}

export default prisma;
