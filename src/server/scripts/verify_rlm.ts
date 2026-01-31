
import prisma from "@/server/db/client";
import { createHash } from "crypto";

// const prisma = new PrismaClient(); // Use the shared instance

async function main() {
    console.log("=== RLM Verification ===");

    // 1. Setup Test Data
    const userId = "test-user-1";
    // Ensure user exists? We might need to mock or create if not exists.
    // Assuming a user exists or we create one.
    let user = await prisma.user.findFirst();
    if (!user) {
        console.log("No user found, creating test user...");
        user = await prisma.user.create({
            data: {
                id: userId,
                email: "test@example.com",
                name: "Test User"
            }
        });
    }

    const provider = "slack";
    const channelId = "C12345";
    const threadId = "p1234567890.123456";
    const messageContent = "Verify RLM memory " + Date.now();
    const providerMessageId = "msg-" + Date.now();

    // 2. Simulate Inbound (Manually invoking Router logic or just inserting to test schema)
    // We will test the SCHEMA and dedupe logic directly here to verify our assumptions.

    console.log("1. Testing Conversation Upsert...");
    const conversation = await prisma.conversation.upsert({
        where: {
            userId_provider_channelId_threadId: {
                userId: user.id,
                provider,
                channelId,
                threadId
            }
        },
        update: {},
        create: {
            userId: user.id,
            provider,
            channelId,
            threadId
        }
    });
    console.log("Conversation ID:", conversation.id);

    console.log("2. Testing Inbound Message Dedupe...");
    const dedupeKey = createHash("sha256")
        .update(`${provider}:${channelId}:${providerMessageId}`)
        .digest("hex");

    const msg1 = await prisma.conversationMessage.upsert({
        where: { dedupeKey },
        update: {},
        create: {
            userId: user.id,
            conversationId: conversation.id,
            dedupeKey,
            role: "user",
            content: messageContent,
            provider,
            providerMessageId,
            channelId,
            threadId
        }
    });

    // Retry should yield same ID
    const msg2 = await prisma.conversationMessage.upsert({
        where: { dedupeKey },
        update: {},
        create: {
            userId: user.id,
            conversationId: conversation.id,
            dedupeKey, // Same key
            role: "user",
            content: messageContent,
            provider,
            providerMessageId,
            channelId,
            threadId
        }
    });

    if (msg1.id !== msg2.id) {
        throw new Error("Dedupe failed! IDs mismatch.");
    }
    console.log("Dedupe Passed. Message ID:", msg1.id);

    console.log("3. Testing Assistant Response Logic...");
    // Simulate Assistant Response
    const assistantContent = "I heard you: " + messageContent;
    const assistantDedupeKey = createHash("sha256")
        .update(`${conversation.id}:${dedupeKey}:assistant`)
        .digest("hex");

    const asstMsg = await prisma.conversationMessage.create({
        data: {
            userId: user.id,
            conversationId: conversation.id,
            dedupeKey: assistantDedupeKey,
            role: "assistant",
            content: assistantContent,
            provider,
            providerMessageId: null,
            channelId,
            threadId
        }
    });
    console.log("Assistant Message Created:", asstMsg.id);

    // 4. Verify History Fetch
    console.log("4. Verifying Context Fetch...");
    const history = await prisma.conversationMessage.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: 'desc' },
        take: 10
    });

    console.log(`Found ${history.length} messages in history.`);
    if (history.length < 2) {
        throw new Error("History missing messages!");
    }
    if (history[0].role !== "assistant" || history[1].role !== "user") {
        console.warn("History order might be unexpected (desc):", history.map(m => m.role));
    }

    console.log("=== Verification Success ===");
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
