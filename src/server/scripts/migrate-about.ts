import { z } from "zod";
import { generateObject } from "ai";
import prisma from "@/server/db/client";
import { getModel } from "@/server/lib/llms/model";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("MigrateAbout");

async function main() {
    logger.info("Starting migration of 'About' field to MemoryFacts...");

    // 1. Fetch accounts with legacy 'about'
    const accounts = await prisma.emailAccount.findMany({
        where: {
            about: { not: null },
        },
        include: { user: true }
    });

    logger.info(`Found ${accounts.length} accounts to migrate.`);

    // Use system default model for extraction
    const modelOptions = getModel();
    const model = modelOptions.model;

    for (const account of accounts) {
        if (!account.about || account.about.trim() === "") continue;

        logger.info(`Processing user ${account.userId}...`);

        try {
            // 2. Extract facts using LLM
            const { object } = await generateObject({
                model,
                schema: z.object({
                    facts: z.array(z.object({
                        key: z.string().describe("Lowercase snake_case key, e.g. dietary_restriction, project_deadline"),
                        value: z.string().describe("The fact content"),
                        scope: z.enum(["global", "domain_specific"]).describe("Whether this applies generally or to a specific domain")
                    }))
                }),
                prompt: `
You are a Memory Manager. extract structured facts from the User's "About" text.
Ignore temporary instructions (e.g. "Draft an email to...").
Focus on long-term facts (preferences, roles, rules, context).

User About Text:
"${account.about}"
                `
            });

            if (object.facts.length === 0) {
                logger.info(`No facts extracted for user ${account.userId}.`);
                continue;
            }

            // 3. Upsert into MemoryFact
            // We do one by one to handle potential key collisions or just create many
            for (const fact of object.facts) {
                // Ensure key is unique per user? The schema says @@unique([userId, key])
                // So we upsert.
                await prisma.memoryFact.upsert({
                    where: {
                        userId_key: {
                            userId: account.userId,
                            key: fact.key
                        }
                    },
                    update: {
                        value: fact.value,
                        scope: fact.scope,
                        updatedAt: new Date()
                    },
                    create: {
                        userId: account.userId,
                        key: fact.key,
                        value: fact.value,
                        scope: fact.scope,
                        sourceMessageId: "migration-script",
                        confidence: 1.0
                    }
                });
            }

            logger.info(`Migrated ${object.facts.length} facts for user ${account.userId}.`);

            // Optional: We DO NOT clear 'about' yet to be safe. 
            // Phase 4 implies dual-run or manual cleanup.

        } catch (error) {
            logger.error(`Failed to migrate user ${account.userId}`, { error });
        }
    }

    logger.info("Migration complete.");
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
