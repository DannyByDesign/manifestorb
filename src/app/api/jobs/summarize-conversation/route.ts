import { NextResponse } from "next/server";
import prisma from "@/server/db/client";
import { createGenerateText } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import { env } from "@/env";
import { z } from "zod";
import { createScopedLogger } from "@/server/lib/logger";
import { EmbeddingService } from "@/features/memory/embeddings/service";
import { EmbeddingQueue } from "@/features/memory/embeddings/queue";
import { posthogCaptureEvent } from "@/server/lib/posthog";
import type { ConversationMessage } from "@/generated/prisma/client";

const logger = createScopedLogger("api/jobs/summarize-conversation");

// ============================================================================
// Configuration
// ============================================================================

const MAX_FACTS_PER_SUMMARY = 5;
const MIN_FACT_CONFIDENCE = 0.7;
const MIN_WORD_MATCH_RATIO = 0.5; // At least 50% of words must appear in messages

// Schema for the structured response from the LLM
const summaryResponseSchema = z.object({
    summary: z.object({
        userPreferences: z.string().optional(),
        openTasks: z.string().optional(),
        recentContext: z.string().optional(),
        importantDates: z.string().optional(),
    }),
    extractedFacts: z.array(z.object({
        key: z.string(),
        value: z.string(),
        confidence: z.number().min(0).max(1),
    })).optional().default([]),
});

// Zod schema for request validation
const summarizeConversationBodySchema = z.object({
    conversationId: z.string().min(1),
});

// ============================================================================
// Fact Validation
// ============================================================================

/**
 * Validate that an extracted fact is grounded in the source messages
 * Prevents hallucinated facts from being stored
 */
function validateExtractedFact(
  fact: { key: string; value: string; confidence: number },
  messages: ConversationMessage[]
): { valid: boolean; reason?: string } {
  // Reject low confidence facts
  if (fact.confidence < MIN_FACT_CONFIDENCE) {
    return { valid: false, reason: `Confidence ${fact.confidence} below threshold ${MIN_FACT_CONFIDENCE}` };
  }
  
  // Check key format
  if (!/^[a-z][a-z0-9_]*$/.test(fact.key)) {
    return { valid: false, reason: 'Invalid key format' };
  }
  
  // Check value length
  if (fact.value.trim().length < 2) {
    return { valid: false, reason: 'Value too short' };
  }
  
  // Check for sensitive content
  const sensitivePatterns = [
    /password|secret|api.?key|credit.?card|ssn|social.?security/i
  ];
  for (const pattern of sensitivePatterns) {
    if (pattern.test(fact.value)) {
      return { valid: false, reason: 'Contains sensitive data' };
    }
  }
  
  // Verify fact value appears in user messages (grounding check)
  const userMessages = messages
    .filter(m => m.role === 'user')
    .map(m => m.content.toLowerCase());
  
  if (userMessages.length === 0) {
    return { valid: false, reason: 'No user messages to validate against' };
  }
  
  // Extract significant words from fact value (exclude common words)
  const commonWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'to', 'of', 'and', 'or', 'for', 'in', 'on', 'at', 'by', 'my', 'i', 'me']);
  const valueWords = fact.value
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 1 && !commonWords.has(w));
  
  if (valueWords.length === 0) {
    return { valid: false, reason: 'No significant words in value' };
  }
  
  // Check how many words appear in user messages
  const matchCount = valueWords.filter(word =>
    userMessages.some(msg => msg.includes(word))
  ).length;
  
  const matchRatio = matchCount / valueWords.length;
  
  if (matchRatio < MIN_WORD_MATCH_RATIO) {
    return { 
      valid: false, 
      reason: `Only ${Math.round(matchRatio * 100)}% of words found in messages (need ${MIN_WORD_MATCH_RATIO * 100}%)` 
    };
  }
  
  return { valid: true };
}

/**
 * Normalize a key for consistent storage
 */
function normalizeKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 100);
}

export async function POST(req: Request) {
    try {
        const authHeader = req.headers.get("Authorization");
        if (authHeader !== `Bearer ${env.JOBS_SHARED_SECRET}`) {
            return new NextResponse("Unauthorized", { status: 401 });
        }

        const body = await req.json();
        
        // Validate request body with Zod
        const parseResult = summarizeConversationBodySchema.safeParse(body);
        if (!parseResult.success) {
            logger.warn("Invalid request body", { errors: parseResult.error.issues });
            return NextResponse.json(
                { error: "Invalid request body", details: parseResult.error.issues },
                { status: 400 }
            );
        }
        
        const { conversationId } = parseResult.data;

        const conversation = await prisma.conversation.findUnique({
            where: { id: conversationId },
            include: { user: true }
        });

        if (!conversation) return new NextResponse("Conversation not found", { status: 404 });

        // 1. Build Context for Summarizer
        // Fetch last summary
        const existingSummary = await prisma.conversationSummary.findUnique({
            where: { conversationId }
        });

        const lastMessageAt = existingSummary?.lastMessageAt || new Date(0);

        // Fetch new messages
        const newMessages = await prisma.conversationMessage.findMany({
            where: {
                conversationId,
                createdAt: { gt: lastMessageAt }
            },
            orderBy: { createdAt: "asc" }
        });

        if (newMessages.length === 0) {
            return NextResponse.json({ skipped: true, reason: "No new messages" });
        }

        // 2. Generate Summary
        // Use economy model for cost-effective summarization
        const modelOptions = getModel("economy");

        const generate = createGenerateText({
            emailAccount: { userId: conversation.user.id, email: conversation.user.email ?? "unknown", id: conversationId } as any, // Mock for utility
            label: "summary-job",
            modelOptions
        });

        const prompt = `
You are a precise Conversation Summarizer with memory extraction capabilities.

Your tasks:
1. Update the conversation summary
2. Extract memorable facts about the user

CURRENT SUMMARY:
${existingSummary?.summary || "No prior summary."}

NEW MESSAGES:
${newMessages.map(m => `${m.role}: ${m.content}`).join("\n")}

OUTPUT FORMAT (JSON):
{
  "summary": {
    "userPreferences": "Any preferences mentioned (e.g., communication style, email preferences)",
    "openTasks": "Pending items or tasks discussed",
    "recentContext": "What just happened in this conversation",
    "importantDates": "Any deadlines or dates mentioned"
  },
  "extractedFacts": [
    {
      "key": "category_specific_identifier",
      "value": "the fact to remember",
      "confidence": 0.8
    }
  ]
}

FACT EXTRACTION RULES:
- Only extract facts explicitly stated by the USER (not inferred or from assistant)
- Use lowercase, underscore keys: "preference_X", "contact_X", "deadline_X", "habit_X"
- Set confidence 0.9+ for explicit statements; use 0.7-0.8 only if explicit but vague
- DO NOT extract: passwords, financial details, or sensitive personal data
- Maximum 5 facts per summary

EXAMPLE FACTS:
- User says "I prefer short emails" → {"key": "preference_email_length", "value": "short and concise", "confidence": 0.95}
- User says "My boss is Sarah" → {"key": "contact_boss", "value": "Sarah", "confidence": 0.9}
- User says "Project deadline is March 15" → {"key": "deadline_current_project", "value": "March 15", "confidence": 0.95}

Keep each summary field concise (1-3 short sentences). No markdown, no explanation.
Respond ONLY with valid JSON.
`;

        const result = await generate({
            model: modelOptions.model,
            messages: [{ role: "user", content: prompt }]
        } as any);

        // 3. Parse the structured response
        let parsedResult: z.infer<typeof summaryResponseSchema>;

        try {
            // Try to parse as JSON
            const cleaned = result.text.trim().replace(/^```json\s*|\s*```$/g, '');
            parsedResult = summaryResponseSchema.parse(JSON.parse(cleaned));
        } catch (e) {
            // Fallback: treat entire response as summary text
            logger.warn("Failed to parse structured summary response", { error: e });
            parsedResult = {
                summary: {
                    recentContext: result.text
                },
                extractedFacts: []
            };
        }

        // Format summary for storage
        const formattedSummary = `
## User Preferences
${parsedResult.summary.userPreferences || "None noted"}

## Open Tasks
${parsedResult.summary.openTasks || "None pending"}

## Recent Context
${parsedResult.summary.recentContext || "No recent activity"}

## Important Dates
${parsedResult.summary.importantDates || "None mentioned"}
`.trim();

        // 4. Validate and store extracted facts as MemoryFacts
        let validFactCount = 0;
        let rejectedFactCount = 0;
        
        if (parsedResult.extractedFacts && parsedResult.extractedFacts.length > 0) {
            // Validate each fact and enforce max limit
            const factsToStore = parsedResult.extractedFacts
                .slice(0, MAX_FACTS_PER_SUMMARY) // Enforce max limit
                .filter(fact => {
                    const validation = validateExtractedFact(fact, newMessages);
                    if (!validation.valid) {
                        logger.trace("Rejected extracted fact", { 
                            key: fact.key, 
                            reason: validation.reason 
                        });
                        rejectedFactCount++;
                        return false;
                    }
                    return true;
                });
            
            for (const fact of factsToStore) {
                try {
                    const normalizedKey = normalizeKey(fact.key);
                    const trimmedValue = fact.value.trim();
                    
                    const memoryFact = await prisma.memoryFact.upsert({
                        where: {
                            userId_key: {
                                userId: conversation.userId,
                                key: normalizedKey
                            }
                        },
                        update: {
                            value: trimmedValue,
                            confidence: fact.confidence,
                            updatedAt: new Date()
                        },
                        create: {
                            userId: conversation.userId,
                            key: normalizedKey,
                            value: trimmedValue,
                            scope: "global",
                            confidence: fact.confidence,
                            sourceMessageId: newMessages[newMessages.length - 1]?.id || null
                        }
                    });

                    // Queue embedding generation (reliable, not fire-and-forget)
                    if (EmbeddingService.isAvailable()) {
                        try {
                            await EmbeddingQueue.enqueue({
                                table: "MemoryFact",
                                recordId: memoryFact.id,
                                text: `${normalizedKey}: ${trimmedValue}`,
                            });
                        } catch (queueError) {
                            logger.warn("Failed to queue embedding for extracted fact", { 
                                error: queueError, 
                                factId: memoryFact.id 
                            });
                        }
                    }

                    validFactCount++;
                    logger.info("Extracted fact from summary", { 
                        key: normalizedKey, 
                        userId: conversation.userId,
                        confidence: fact.confidence
                    });
                } catch (factError) {
                    logger.warn("Failed to save extracted fact", { error: factError, key: fact.key });
                }
            }
            
            // Track in PostHog
            if (validFactCount > 0) {
                const userEmail = conversation.user?.email;
                if (userEmail) {
                    posthogCaptureEvent(userEmail, "memory_facts_extracted", {
                        count: validFactCount,
                        rejected: rejectedFactCount,
                        source: "summarization",
                        conversationId,
                    }).catch(() => {}); // Fire and forget analytics
                }
            }
        }

        // 5. Save summary
        const newestDate = newMessages[newMessages.length - 1].createdAt;

        await prisma.conversationSummary.upsert({
            where: { conversationId },
            update: {
                summary: formattedSummary,
                lastMessageAt: newestDate
            },
            create: {
                conversationId,
                summary: formattedSummary,
                lastMessageAt: newestDate
            }
        });

        return NextResponse.json({ 
            success: true, 
            updated: true,
            factsExtracted: parsedResult.extractedFacts.length 
        });
    } catch (err) {
        logger.error("Error summarizing conversation", { error: err });
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Internal Server Error" },
            { status: 500 }
        );
    }
}
