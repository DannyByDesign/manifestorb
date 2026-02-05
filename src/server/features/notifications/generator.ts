import { createGenerateText } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import type { EmailAccountWithAI } from "@/server/lib/llms/types";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("services/notification/generator");

export type NotificationType = "email" | "calendar" | "system" | "task";

export interface NotificationContext {
    type: NotificationType;
    source: string; // e.g., "Uber", "Danny", "System", "Google Calendar"
    title: string;  // e.g., "Receipt", "Meeting Invite", "Disk Full"
    detail: string; // e.g., "Total $45.23", "3:00 PM tomorrow", "98% usage"
    importance: "high" | "medium" | "low";
}

/**
 * Generates a conversational "heads-up" notification using a fast LLM.
 * Falls back to a constructed string if the LLM fails or times out.
 */
export async function generateNotification(
    context: NotificationContext,
    userParams: {
        emailAccount: EmailAccountWithAI
    }
): Promise<string> {
    const { emailAccount } = userParams;

    // 1. Construct the fallback message immediately (fail-safe)
    const fallbackMessage = constructFallback(context);

    try {
        // 2. Select the fastest available model (Chat profile)
        // We prioritize speed over reasoning depth here.
        const modelOptions = getModel("chat");

        // 3. Create the generator
        const generateText = createGenerateText({
            emailAccount,
            label: "agentic-notification",
            modelOptions,
        });

        // 4. Prompt Engineering
        const systemPrompt = `You are an intelligent personal assistant.
Your goal is to write a single-sentence push notification for the user's phone.

Context:
- Event: ${context.type.toUpperCase()}
- Source: ${context.source}
- Title: ${context.title}
- Detail: ${context.detail}

Rules:
1. Be strictly under 20 words.
2. Be conversational but direct (like a text from a helpful assistant).
3. Focus on the *value* (money, time, urgency).
4. NO hashtags, NO preambles, NO "Here is your notification".
5. If it's a receipt, mention the amount. If it's a calendar invite, mention the time.
6. No bullet lists or extra commentary.`;

        // 5. Execute with Timeout (Race)
        // We give the LLM 10.0 seconds. If it's slower, we use the fallback.
        const timeoutPromise = new Promise<string>((resolve) => {
            setTimeout(() => resolve(fallbackMessage), 10000);
        });

        const generationPromise = generateText({
            system: systemPrompt,
            prompt: "Generate notification.",
            maxTokens: 60,
            temperature: 0.3, // Low temperature for consistency
        } as any).then((res) => {
            let text = res.text.trim();
            // Cleanup common LLM artifacts if any slip through
            text = text.replace(/^"(.*)"$/, "$1"); // Remove surrounding quotes
            return text;
        });

        const result = await Promise.race([generationPromise, timeoutPromise]);

        // If result is the fallback, log it
        if (result === fallbackMessage) {
            logger.warn("Agentic notification timed out or failed, used fallback", {
                model: modelOptions.modelName
            });
        }

        return result;

    } catch (error) {
        logger.error("Failed to generate agentic notification", { error });
        return fallbackMessage;
    }
}

function constructFallback(context: NotificationContext): string {
    const icon = getIconForType(context.type);
    return `${icon} ${context.source}: ${context.title} - ${context.detail}`.substring(0, 150);
}

function getIconForType(type: NotificationType): string {
    switch (type) {
        case "email": return "📧";
        case "calendar": return "📅";
        case "system": return "🔔";
        case "task": return "✅";
        default: return "🔔";
    }
}
