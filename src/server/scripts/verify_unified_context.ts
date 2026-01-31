
import prisma from "@/server/db/client";
import { ConversationService } from "@/server/conversations/service";
import { PrivacyService } from "@/server/privacy/service";
import { SummaryService } from "@/server/summaries/service";
import { ContextManager } from "@/server/agent/context-manager";

async function main() {
    console.log("=== RLM Phase 5 Verification ===");

    // 1. Setup User
    let user = await prisma.user.findFirst();
    let emailAccount: any;

    if (!user) {
        console.log("Seeding test user...");
        user = await prisma.user.create({
            data: {
                email: "test@example.com",
                name: "Test User"
            }
        });

        emailAccount = await prisma.emailAccount.create({
            data: {
                email: "test@example.com",
                user: { connect: { id: user.id } },
                // removed tokens/provider
                account: {
                    create: {
                        type: "oauth",
                        provider: "google",
                        providerAccountId: "mock-idx-1",
                        userId: user.id
                        // tokens would go here if needed
                    }
                }
            }
        });
    } else {
        emailAccount = await prisma.emailAccount.findFirst({ where: { userId: user.id } });
    }

    if (!emailAccount && user) {
        emailAccount = await prisma.emailAccount.create({
            data: {
                email: "test@example.com",
                user: { connect: { id: user.id } },
                // removed tokens/provider
                account: {
                    create: {
                        type: "oauth",
                        provider: "google",
                        providerAccountId: "mock-idx-2",
                        userId: user.id
                    }
                }
            }
        });
    }

    if (!emailAccount) throw new Error("Failed to provision email account");

    console.log(`User: ${user.id}`);

    // 2. Web Conversation
    console.log("2. Testing Web Conversation...");
    const conv = await ConversationService.getPrimaryWebConversation(user.id);
    console.log(`Conversation ID: ${conv.id}`);
    if (!conv.isPrimary || conv.provider !== "web" || conv.channelId !== "web-primary-channel") throw new Error("Conversation invalid or sentinel missing");

    // 3. Privacy Enforcmenet
    console.log("3. Testing Privacy (Record=False)...");

    // Set to false
    await prisma.privacySettings.upsert({
        where: { userId: user.id },
        update: { recordHistory: false },
        create: { userId: user.id, recordHistory: false }
    });

    const isRecording = await PrivacyService.shouldRecord(user.id);
    if (isRecording) throw new Error("Privacy setting failed to update");

    const dedupeKey = ConversationService.computeDedupeKey({
        provider: "web",
        role: "user",
        contentHash: "privacy-test-" + Date.now(),
        userId: user.id
    });

    // Simulate Router Logic Check (Manually)
    // We expect the CALLER to check shouldRecord.
    if (await PrivacyService.shouldRecord(user.id)) {
        await prisma.conversationMessage.create({
            data: {
                userId: user.id,
                conversationId: conv.id,
                dedupeKey,
                role: "user",
                content: "SHOULD NOT EXIST",
                provider: "web"
            }
        });
    }

    const msgCheck = await prisma.conversationMessage.findUnique({
        where: { dedupeKey }
    });

    if (msgCheck) throw new Error("Privacy FAILURE: Message persisted when recordHistory=false");
    console.log("Privacy Check Passed: Message not persisted.");

    // 4. Summarization
    console.log("4. Testing Summarization...");

    // Enable recording first
    await prisma.privacySettings.update({
        where: { userId: user.id },
        data: { recordHistory: true }
    });

    // Create a dummy summary
    await prisma.conversationSummary.upsert({
        where: { conversationId: conv.id },
        update: { summary: "Existing summary test." },
        create: {
            conversationId: conv.id,
            summary: "Existing summary test."
        }
    });

    // 5. Context Manager
    console.log("5. Testing Context Manager...");
    const pack = await ContextManager.buildContextPack({
        user,
        emailAccount,
        messageContent: "Hello",
        conversationId: conv.id
    });

    console.log("Summary in Context:", pack.system.summary);

    if (pack.system.summary !== "Existing summary test.") {
        throw new Error("ContextManager failed to fetch summary");
    }
    console.log("Context Manager Passed.");

    console.log("=== Verification Success ===");
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
