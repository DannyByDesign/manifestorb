/**
 * Memory Recording API
 * 
 * Unified endpoint for USER-LEVEL summarization and comprehensive fact extraction.
 * Triggers at 120K tokens (~75% of context capacity).
 * 
 * UNIFIED MEMORY: Processes all user messages across ALL platforms/conversations.
 * Updates UserSummary (not ConversationSummary) for cross-platform continuity.
 * 
 * This replaces the old /api/jobs/summarize-conversation endpoint with:
 * - Enhanced extraction prompt with categories and evidence
 * - Higher fact limit (20 vs 5)
 * - Semantic deduplication before storage
 * - User-level (not conversation-level) processing
 */
import { NextResponse } from "next/server";
import prisma from "@/server/db/client";
import { createGenerateText } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import { env } from "@/env";
import { z } from "zod";
import { createScopedLogger } from "@/server/lib/logger";
import { EmbeddingService } from "@/features/memory/embeddings/service";
import { EmbeddingQueue } from "@/features/memory/embeddings/queue";
import { checkForDuplicate } from "@/features/memory/embeddings/search";
import { posthogCaptureEvent } from "@/server/lib/posthog";
import type { ConversationMessage } from "@/generated/prisma/client";
import {
    createInteractionEpisode,
    recordCommitment,
    recordMemoryEvidence,
    recordRelationshipAssertion,
    safeIsoNow,
} from "@/server/features/memory/structured/service";

const logger = createScopedLogger("api/jobs/record-memory");

// ============================================================================
// Configuration
// ============================================================================

const MAX_FACTS_PER_RECORDING = 20; // Increased from 5 - more context = more facts
const MIN_FACT_CONFIDENCE = 0.6;    // Slightly lower threshold since we have evidence

// Schema for the structured response from the LLM
const memoryRecordingResponseSchema = z.object({
    schemaVersion: z.literal("v2").default("v2"),
    summary: z.object({
        compressed: z.string(),
        openLoops: z.string().optional(),
        emotionalContext: z.string().optional(),
    }),
    extractedFacts: z.array(z.object({
        category: z.enum(["contact", "preference", "context", "behavior", "deadline", "relationship"]),
        key: z.string(),
        value: z.string(),
        confidence: z.number().min(0).max(1),
        evidence: z.string().optional(), // Quote from user that supports this
    })).optional().default([]),
    relationshipAssertions: z.array(z.object({
        personName: z.string().min(1),
        relatedPersonName: z.string().optional(),
        relationType: z.enum(["manager", "peer", "direct_report", "client", "vendor", "partner", "personal", "other"]),
        assertion: z.string().min(1),
        confidence: z.number().min(0).max(1),
        evidence: z.string().optional(),
    })).optional().default([]),
    commitmentAssertions: z.array(z.object({
        description: z.string().min(1),
        owner: z.enum(["user", "other"]).default("user"),
        counterpartName: z.string().optional(),
        dueAt: z.string().optional(),
        confidence: z.number().min(0).max(1),
        evidence: z.string().optional(),
    })).optional().default([]),
});

// Request validation - UNIFIED: accepts userId (not conversationId)
const requestBodySchema = z.object({
    userId: z.string().min(1),
    email: z.string().email(),
});

// ============================================================================
// Fact Validation
// ============================================================================

interface ExtractedFact {
    category: string;
    key: string;
    value: string;
    confidence: number;
    evidence?: string;
}

interface RelationshipAssertion {
    personName: string;
    relatedPersonName?: string;
    relationType: "manager" | "peer" | "direct_report" | "client" | "vendor" | "partner" | "personal" | "other";
    assertion: string;
    confidence: number;
    evidence?: string;
}

interface CommitmentAssertion {
    description: string;
    owner: "user" | "other";
    counterpartName?: string;
    dueAt?: string;
    confidence: number;
    evidence?: string;
}

function validateEvidenceGrounding(
    evidence: string | undefined,
    messages: ConversationMessage[]
): { valid: boolean; reason?: string } {
    if (!evidence || evidence.length <= 5) return { valid: true };

    const userMessages = messages
        .filter((message) => message.role === "user")
        .map((message) => message.content.toLowerCase());

    const evidenceWords = evidence.toLowerCase().split(/\s+/).filter((word) => word.length > 3);
    const foundWords = evidenceWords.filter((word) =>
        userMessages.some((message) => message.includes(word))
    );

    if (evidenceWords.length > 0 && foundWords.length < evidenceWords.length * 0.5) {
        return { valid: false, reason: "Evidence not found in user messages" };
    }

    return { valid: true };
}

function validateRelationshipAssertion(
    assertion: RelationshipAssertion,
    messages: ConversationMessage[]
): { valid: boolean; reason?: string } {
    if (assertion.confidence < MIN_FACT_CONFIDENCE) {
        return { valid: false, reason: `Low confidence: ${assertion.confidence}` };
    }
    if (!assertion.personName.trim()) {
        return { valid: false, reason: "Missing person name" };
    }
    if (!assertion.assertion.trim()) {
        return { valid: false, reason: "Missing assertion text" };
    }
    return validateEvidenceGrounding(assertion.evidence, messages);
}

function validateCommitmentAssertion(
    commitment: CommitmentAssertion,
    messages: ConversationMessage[]
): { valid: boolean; reason?: string } {
    if (commitment.confidence < MIN_FACT_CONFIDENCE) {
        return { valid: false, reason: `Low confidence: ${commitment.confidence}` };
    }
    if (!commitment.description.trim()) {
        return { valid: false, reason: "Missing commitment description" };
    }
    return validateEvidenceGrounding(commitment.evidence, messages);
}

function normalizeDueAt(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return undefined;
    return parsed.toISOString();
}

function relationshipExtractionEnabled(): boolean {
    const raw = process.env.MEMORY_RECORDING_RELATIONSHIPS_ENABLED;
    if (!raw) return true;
    return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function commitmentExtractionEnabled(): boolean {
    const raw = process.env.MEMORY_RECORDING_COMMITMENTS_ENABLED;
    if (!raw) return true;
    return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function buildSyntheticRelationshipFromFact(fact: ExtractedFact): RelationshipAssertion | null {
    if (fact.category !== "relationship") return null;
    const keyTokens = fact.key.split("_").filter(Boolean);
    const personName = keyTokens.length > 0 ? keyTokens[0] : "Unknown";
    return {
        personName,
        relationType: "other",
        assertion: fact.value,
        confidence: fact.confidence,
        evidence: fact.evidence,
    };
}

function buildSyntheticCommitmentFromFact(fact: ExtractedFact): CommitmentAssertion | null {
    if (fact.category !== "deadline") return null;
    return {
        description: `${fact.key}: ${fact.value}`,
        owner: "user",
        dueAt: undefined,
        confidence: fact.confidence,
        evidence: fact.evidence,
    };
}

function coerceStructuredAssertions(parsedResult: z.infer<typeof memoryRecordingResponseSchema>) {
    const relationshipAssertions: RelationshipAssertion[] = parsedResult.relationshipAssertions ?? [];
    const commitmentAssertions: CommitmentAssertion[] = parsedResult.commitmentAssertions ?? [];

    if (relationshipAssertions.length === 0) {
        for (const fact of parsedResult.extractedFacts ?? []) {
            const synthetic = buildSyntheticRelationshipFromFact(fact as ExtractedFact);
            if (synthetic) relationshipAssertions.push(synthetic);
        }
    }

    if (commitmentAssertions.length === 0) {
        for (const fact of parsedResult.extractedFacts ?? []) {
            const synthetic = buildSyntheticCommitmentFromFact(fact as ExtractedFact);
            if (synthetic) commitmentAssertions.push(synthetic);
        }
    }

    return { relationshipAssertions, commitmentAssertions };
}

/**
 * Validate that an extracted fact is grounded and useful
 */
function validateFact(
    fact: ExtractedFact,
    messages: ConversationMessage[]
): { valid: boolean; reason?: string } {
    // Reject low confidence
    if (fact.confidence < MIN_FACT_CONFIDENCE) {
        return { valid: false, reason: `Low confidence: ${fact.confidence}` };
    }

    // Check value length
    if (fact.value.trim().length < 2) {
        return { valid: false, reason: "Value too short" };
    }

    // Check for sensitive content
    const sensitivePatterns = [
        /password|secret|api.?key|credit.?card|ssn|social.?security/i,
        /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, // Credit card pattern
    ];
    for (const pattern of sensitivePatterns) {
        if (pattern.test(fact.value)) {
            return { valid: false, reason: "Contains sensitive data" };
        }
    }

    return validateEvidenceGrounding(fact.evidence, messages);
}

/**
 * Normalize a key for consistent storage
 */
function normalizeKey(category: string, key: string): string {
    const normalized = key
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_]/g, "")
        .slice(0, 80);
    
    // Prefix with category if not already
    if (!normalized.startsWith(category)) {
        return `${category}_${normalized}`;
    }
    return normalized;
}

// ============================================================================
// Enhanced Extraction Prompt
// ============================================================================

function buildMemoryRecordingPrompt(
    existingSummary: string | null,
    messages: ConversationMessage[]
): string {
    const messageCount = messages.length;
    const formattedMessages = messages
        .map(m => `[${m.role.toUpperCase()}]: ${m.content}`)
        .join("\n\n");

    return `You are a Memory Recording System for a personal AI assistant.

Your job is to analyze this conversation chunk and extract TWO things:
1. A compressed summary (for context continuity)
2. ALL learnable facts about the user (for long-term memory)

---

## CONVERSATION CHUNK (${messageCount} messages)

${formattedMessages}

---

## EXISTING SUMMARY (if any)

${existingSummary || "No prior summary."}

---

## OUTPUT FORMAT (JSON)

{
  "schemaVersion": "v2",
  "summary": {
    "compressed": "2-3 sentence summary of what happened in this chunk",
    "openLoops": "Any pending questions, tasks, or unresolved topics",
    "emotionalContext": "User's apparent mood or frustration level if relevant"
  },
  "extractedFacts": [
    {
      "category": "contact|preference|context|behavior|deadline|relationship",
      "key": "descriptive_snake_case_key",
      "value": "the fact to remember",
      "confidence": 0.8,
      "evidence": "exact quote from user that supports this"
    }
  ],
  "relationshipAssertions": [
    {
      "personName": "Sarah Johnson",
      "relatedPersonName": "User",
      "relationType": "manager",
      "assertion": "Sarah is the user's manager and asks for frequent status updates",
      "confidence": 0.86,
      "evidence": "My manager Sarah asked me for updates again."
    }
  ],
  "commitmentAssertions": [
    {
      "description": "Send revised board deck",
      "owner": "user",
      "counterpartName": "Sarah Johnson",
      "dueAt": "2026-03-15T17:00:00Z",
      "confidence": 0.82,
      "evidence": "I'll send Sarah the updated deck before Friday."
    }
  ]
}

---

## FACT EXTRACTION GUIDELINES

Extract facts in these categories:

**CONTACT** - People the user mentions
- Names, roles, relationships, email patterns
- Example: {"category": "contact", "key": "manager_name", "value": "Sarah Johnson, VP of Marketing", "confidence": 0.95, "evidence": "My manager Sarah Johnson wants..."}

**PREFERENCE** - How the user likes things done
- Communication style, priorities, pet peeves, work habits
- Example: {"category": "preference", "key": "email_style", "value": "short and direct, bullet points preferred", "confidence": 0.9, "evidence": "I prefer short emails with bullet points"}

**CONTEXT** - Ongoing situations
- Current projects, company info, team dynamics
- Example: {"category": "context", "key": "current_project", "value": "Q3 revenue report, presenting to board", "confidence": 0.85, "evidence": "working on the Q3 report for the board"}

**BEHAVIOR** - Patterns you notice
- When they work, how they respond, habits
- Example: {"category": "behavior", "key": "response_time", "value": "responds to urgent emails within 2 hours", "confidence": 0.7, "evidence": "I usually reply to urgent stuff within a couple hours"}

**DEADLINE** - Time-sensitive information
- Due dates, meetings, commitments
- Example: {"category": "deadline", "key": "board_presentation", "value": "March 15, 2026", "confidence": 0.95, "evidence": "presentation is on March 15th"}

**RELATIONSHIP** - Dynamics between people
- Who reports to whom, tensions, alliances, communication patterns
- Example: {"category": "relationship", "key": "sarah_communication", "value": "sends many urgent emails that aren't actually urgent, user frustrated", "confidence": 0.85, "evidence": "Sarah keeps marking things urgent when they're not"}

---

## RULES

1. ONLY extract facts from USER messages (not assistant responses)
2. Include "evidence" - an exact or near-exact quote from the user
3. Set confidence based on how explicit the statement was:
   - 0.9-1.0: Explicit statement ("My boss is Sarah")
   - 0.7-0.9: Strong implication ("Sarah assigned me this project" → likely manager)
   - 0.5-0.7: Inference (only if highly useful)
4. DO NOT extract: passwords, financial data, health info, one-time logistics
5. Extract as many genuinely useful facts as you find (up to 20)
6. Use specific, descriptive keys that won't conflict with other facts
7. Use lowercase, underscore keys only (no spaces or special characters)
8. NEVER include absolute dates like "today is Feb 5" or "as of January 2026" in the compressed summary. Summaries must be date-agnostic because they are cached and reused across sessions. Use relative time only if necessary (e.g., "user has an upcoming deadline" not "user has a deadline on Feb 10").
9. relationshipAssertions and commitmentAssertions must include grounded evidence from user messages.
10. If a new relationship assertion contradicts an older one, prefer the newer one with higher confidence.

Respond ONLY with valid JSON. No markdown code fences, no explanation.`;
}

// ============================================================================
// Main Handler
// ============================================================================

export async function POST(req: Request) {
    try {
        // Auth check
        const authHeader = req.headers.get("Authorization");
        if (authHeader !== `Bearer ${env.JOBS_SHARED_SECRET}`) {
            return new NextResponse("Unauthorized", { status: 401 });
        }

        const body = await req.json();
        const parseResult = requestBodySchema.safeParse(body);
        if (!parseResult.success) {
            logger.warn("Invalid request body", { errors: parseResult.error.issues });
            return NextResponse.json(
                { error: "Invalid request body", details: parseResult.error.issues },
                { status: 400 }
            );
        }

        const { userId, email } = parseResult.data;

        // Fetch user
        const user = await prisma.user.findUnique({
            where: { id: userId }
        });

        if (!user) {
            return new NextResponse("User not found", { status: 404 });
        }

        // Get existing user-level summary and new messages (UNIFIED across all platforms)
        const userSummary = await prisma.userSummary.findUnique({
            where: { userId }
        });

        const lastMessageAt = userSummary?.lastMessageAt || new Date(0);

        // UNIFIED: Fetch messages from ALL user conversations
        const newMessages = await prisma.conversationMessage.findMany({
            where: {
                userId,  // All user messages, not per-conversation
                createdAt: { gt: lastMessageAt }
            },
            orderBy: { createdAt: "asc" }
        });

        if (newMessages.length === 0) {
            return NextResponse.json({ skipped: true, reason: "No new messages" });
        }

        // Estimate tokens for logging
        const totalChars = newMessages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
        const estimatedTokens = Math.ceil(totalChars / 4);

        logger.info("Starting memory recording", {
            userId,
            messageCount: newMessages.length,
            estimatedTokens,
            email
        });

        // Build prompt and generate - uses system Gemini 2.5 Flash
        const modelOptions = getModel("economy");

        const generate = createGenerateText({
            emailAccount: { id: user.id, email, userId: user.id },
            label: "memory-recording",
            modelOptions
        });

        const prompt = buildMemoryRecordingPrompt(
            userSummary?.summary || null,
            newMessages
        );

        const result = await generate({
            model: modelOptions.model,
            messages: [{ role: "user", content: prompt }]
        });

        // Parse response
        let parsedResult: z.infer<typeof memoryRecordingResponseSchema>;

        try {
            const cleaned = result.text.trim().replace(/^```json\s*|\s*```$/g, "");
            parsedResult = memoryRecordingResponseSchema.parse(JSON.parse(cleaned));
        } catch (e) {
            logger.warn("Failed to parse memory recording response", { error: e });
            parsedResult = {
                schemaVersion: "v2",
                summary: {
                    compressed: result.text.slice(0, 500),
                },
                extractedFacts: [],
                relationshipAssertions: [],
                commitmentAssertions: [],
            };
        }

        const latestMessage = newMessages[newMessages.length - 1];
        const episodeId = await createInteractionEpisode(userId, {
            title: "Memory recording chunk",
            summary: parsedResult.summary.compressed,
            sourceConversationId: latestMessage?.conversationId,
            sourceEmailThreadId: latestMessage?.threadId ?? undefined,
            startedAt: newMessages[0]?.createdAt,
            endedAt: latestMessage?.createdAt,
        });
        const { relationshipAssertions, commitmentAssertions } = coerceStructuredAssertions(parsedResult);

        // Store facts with validation and deduplication
        let validFactCount = 0;
        let rejectedFactCount = 0;
        let duplicateCount = 0;
        let relationshipStoredCount = 0;
        let relationshipRejectedCount = 0;
        let commitmentStoredCount = 0;
        let commitmentRejectedCount = 0;

        if (parsedResult.extractedFacts && parsedResult.extractedFacts.length > 0) {
            const factsToProcess = parsedResult.extractedFacts.slice(0, MAX_FACTS_PER_RECORDING);

            for (const fact of factsToProcess) {
                // Validate
                const validation = validateFact(fact, newMessages);
                if (!validation.valid) {
                    logger.trace("Rejected fact", { key: fact.key, reason: validation.reason });
                    rejectedFactCount++;
                    continue;
                }

                const normalizedKey = normalizeKey(fact.category, fact.key);
                const trimmedValue = fact.value.trim();

                // Semantic deduplication
                try {
                    const existingDupe = await checkForDuplicate({
                        userId,  // UNIFIED: User-level deduplication
                        key: normalizedKey,
                        value: trimmedValue
                    });

                    if (existingDupe && existingDupe.confidence >= fact.confidence) {
                        logger.trace("Skipping duplicate fact", { 
                            key: normalizedKey, 
                            existingKey: existingDupe.key 
                        });
                        duplicateCount++;
                        continue;
                    }
                } catch (e) {
                    // Continue even if dedupe fails
                    logger.warn("Dedupe check failed", { error: e });
                }

                // Store fact
                try {
                    const memoryFact = await prisma.memoryFact.upsert({
                        where: {
                            userId_key: {
                                userId,  // UNIFIED: User-level facts
                                key: normalizedKey
                            }
                        },
                        update: {
                            value: trimmedValue,
                            confidence: fact.confidence,
                            scope: fact.category,
                            updatedAt: new Date()
                        },
                        create: {
                            userId,  // UNIFIED: User-level facts
                            key: normalizedKey,
                            value: trimmedValue,
                            scope: fact.category,
                            confidence: fact.confidence,
                            sourceMessageId: newMessages[newMessages.length - 1]?.id || null
                        }
                    });

                    // Queue embedding
                    if (EmbeddingService.isAvailable()) {
                        await EmbeddingQueue.enqueue({
                            table: "MemoryFact",
                            recordId: memoryFact.id,
                            text: `${normalizedKey}: ${trimmedValue}`,
                        }).catch(e => logger.warn("Failed to queue embedding", { error: e }));
                    }

                    validFactCount++;
                    logger.info("Stored fact", {
                        key: normalizedKey,
                        category: fact.category,
                        confidence: fact.confidence,
                        hasEvidence: !!fact.evidence
                    });
                } catch (e) {
                    logger.warn("Failed to store fact", { error: e, key: normalizedKey });
                }
            }
        }

        if (relationshipExtractionEnabled() && relationshipAssertions.length > 0) {
            for (const assertion of relationshipAssertions) {
                const validation = validateRelationshipAssertion(assertion, newMessages);
                if (!validation.valid) {
                    relationshipRejectedCount++;
                    logger.trace("Rejected relationship assertion", {
                        personName: assertion.personName,
                        reason: validation.reason,
                    });
                    continue;
                }

                const saved = await recordRelationshipAssertion({
                    userId,
                    input: {
                        personName: assertion.personName,
                        relatedPersonName: assertion.relatedPersonName,
                        relationType: assertion.relationType,
                        assertion: assertion.assertion,
                        confidence: assertion.confidence,
                        evidenceSnippet: assertion.evidence,
                        sourceMessageId: latestMessage?.id,
                        episodeId: episodeId ?? undefined,
                    },
                });

                if (saved) {
                    relationshipStoredCount++;
                    if (assertion.evidence) {
                        await recordMemoryEvidence({
                            userId,
                            sourceMessageId: latestMessage?.id,
                            excerpt: assertion.evidence,
                        });
                    }
                } else {
                    relationshipRejectedCount++;
                }
            }
        }

        if (commitmentExtractionEnabled() && commitmentAssertions.length > 0) {
            for (const commitment of commitmentAssertions) {
                const validation = validateCommitmentAssertion(commitment, newMessages);
                if (!validation.valid) {
                    commitmentRejectedCount++;
                    logger.trace("Rejected commitment assertion", {
                        description: commitment.description,
                        reason: validation.reason,
                    });
                    continue;
                }

                const saved = await recordCommitment({
                    userId,
                    input: {
                        description: commitment.description,
                        owner: commitment.owner,
                        counterpartName: commitment.counterpartName,
                        dueAt: normalizeDueAt(commitment.dueAt),
                        confidence: commitment.confidence,
                        evidenceSnippet: commitment.evidence,
                        sourceMessageId: latestMessage?.id,
                        episodeId: episodeId ?? undefined,
                    },
                });

                if (saved) {
                    commitmentStoredCount++;
                    if (commitment.evidence) {
                        await recordMemoryEvidence({
                            userId,
                            sourceMessageId: latestMessage?.id,
                            excerpt: commitment.evidence,
                        });
                    }
                } else {
                    commitmentRejectedCount++;
                }
            }
        }

        // Format and store USER-LEVEL summary (UNIFIED across all platforms)
        const formattedSummary = `## Summary
${parsedResult.summary.compressed}

## Open Loops
${parsedResult.summary.openLoops || "None"}

## Context
${parsedResult.summary.emotionalContext || "Neutral"}

## Recording Metadata
- schemaVersion: ${parsedResult.schemaVersion}
- recordedAt: ${safeIsoNow()}
- episodeId: ${episodeId ?? "none"}`;

        const newestDate = newMessages[newMessages.length - 1].createdAt;

        // UNIFIED: Store in UserSummary (not ConversationSummary)
        await prisma.userSummary.upsert({
            where: { userId },
            update: {
                summary: formattedSummary,
                lastMessageAt: newestDate
            },
            create: {
                userId,
                summary: formattedSummary,
                lastMessageAt: newestDate
            }
        });

        // Track analytics
        posthogCaptureEvent(email, "memory_recording_completed", {
            userId,
            messageCount: newMessages.length,
            estimatedTokens,
            factsExtracted: validFactCount,
            factsRejected: rejectedFactCount,
            factsDuplicate: duplicateCount,
            relationshipStored: relationshipStoredCount,
            relationshipRejected: relationshipRejectedCount,
            commitmentStored: commitmentStoredCount,
            commitmentRejected: commitmentRejectedCount,
            schemaVersion: parsedResult.schemaVersion,
            episodeId: episodeId ?? null,
        }).catch(() => {});

        logger.info("Memory recording completed", {
            userId,
            messageCount: newMessages.length,
            factsExtracted: validFactCount,
            factsRejected: rejectedFactCount,
            factsDuplicate: duplicateCount,
            relationshipStored: relationshipStoredCount,
            relationshipRejected: relationshipRejectedCount,
            commitmentStored: commitmentStoredCount,
            commitmentRejected: commitmentRejectedCount,
            schemaVersion: parsedResult.schemaVersion,
            episodeId: episodeId ?? null,
        });

        return NextResponse.json({
            success: true,
            stats: {
                messagesProcessed: newMessages.length,
                estimatedTokens,
                factsExtracted: validFactCount,
                factsRejected: rejectedFactCount,
                factsDuplicate: duplicateCount,
                relationshipStored: relationshipStoredCount,
                relationshipRejected: relationshipRejectedCount,
                commitmentStored: commitmentStoredCount,
                commitmentRejected: commitmentRejectedCount,
                schemaVersion: parsedResult.schemaVersion,
                episodeId: episodeId ?? null,
            }
        });

    } catch (err) {
        logger.error("Memory recording failed", { error: err });
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Internal Server Error" },
            { status: 500 }
        );
    }
}
