/**
 * Backfill UserSummary from ConversationSummary
 * 
 * ONE-TIME MIGRATION SCRIPT
 * 
 * This script migrates existing per-conversation summaries to user-level summaries.
 * For each user with conversation summaries, it:
 * 1. Finds all their conversation summaries
 * 2. Takes the most recent one as the base
 * 3. Creates a UserSummary record
 * 
 * Run with: bunx tsx src/server/scripts/backfill-user-summary.ts
 */
import prisma from "@/server/db/client";

async function backfillUserSummaries() {
    console.log("Starting UserSummary backfill...");

    // Get all users who have conversation summaries but no user summary
    const usersWithConversationSummaries = await prisma.user.findMany({
        where: {
            conversations: {
                some: {
                    summary: {
                        isNot: null
                    }
                }
            },
            userSummary: null  // Only users without a UserSummary
        },
        select: {
            id: true,
            email: true,
            conversations: {
                where: {
                    summary: {
                        isNot: null
                    }
                },
                include: {
                    summary: true
                },
                orderBy: {
                    updatedAt: 'desc'
                }
            }
        }
    });

    console.log(`Found ${usersWithConversationSummaries.length} users to migrate`);

    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const user of usersWithConversationSummaries) {
        try {
            // Combine summaries from all conversations (most recent first)
            const summaries = user.conversations
                .filter(c => c.summary)
                .map(c => c.summary!)
                .sort((a, b) => {
                    const aDate = a.lastMessageAt || a.updatedAt;
                    const bDate = b.lastMessageAt || b.updatedAt;
                    return bDate.getTime() - aDate.getTime();
                });

            if (summaries.length === 0) {
                skipped++;
                continue;
            }

            // Use the most recent summary as the base
            const mostRecent = summaries[0];
            
            // If multiple summaries, combine them
            let combinedSummary = mostRecent.summary;
            if (summaries.length > 1) {
                // Combine up to 3 most recent summaries
                const topSummaries = summaries.slice(0, 3);
                combinedSummary = topSummaries
                    .map((s, i) => `### Context ${i + 1}\n${s.summary}`)
                    .join("\n\n---\n\n");
            }

            // Find the most recent lastMessageAt across all summaries
            const lastMessageAt = summaries.reduce((latest, s) => {
                const date = s.lastMessageAt || s.updatedAt;
                return date > latest ? date : latest;
            }, new Date(0));

            // Create UserSummary
            await prisma.userSummary.create({
                data: {
                    userId: user.id,
                    summary: combinedSummary,
                    lastMessageAt: lastMessageAt
                }
            });

            migrated++;
            console.log(`Migrated user ${user.email} (${summaries.length} summaries combined)`);

        } catch (err) {
            errors++;
            console.error(`Failed to migrate user ${user.id}:`, err);
        }
    }

    console.log("\n=== Backfill Complete ===");
    console.log(`Migrated: ${migrated}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Errors: ${errors}`);
}

// Run the backfill
backfillUserSummaries()
    .then(() => {
        console.log("Done!");
        process.exit(0);
    })
    .catch((err) => {
        console.error("Backfill failed:", err);
        process.exit(1);
    });
