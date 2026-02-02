/**
 * Memory Recording Worker
 * 
 * Processes memory recording jobs for USER-LEVEL summarization and fact extraction.
 * Runs in the sidecar with no timeout constraints.
 * 
 * UNIFIED MEMORY: Processes all user messages across ALL platforms/conversations.
 * Updates UserSummary for cross-platform continuity.
 */
import { prisma } from '../db/prisma';
import { redis } from '../db/redis';

// ============================================================================
// Configuration
// ============================================================================

const MAX_FACTS_PER_RECORDING = 20;
const MIN_FACT_CONFIDENCE = 0.6;

// Embedding queue key (same as main app)
const EMBEDDING_QUEUE_KEY = 'embedding:queue';

// ============================================================================
// Types
// ============================================================================

interface ConversationMessage {
    id: string;
    role: string;
    content: string;
    createdAt: Date;
}

interface ExtractedFact {
    category: string;
    key: string;
    value: string;
    confidence: number;
    evidence?: string;
}

interface MemoryRecordingResult {
    summary: {
        compressed: string;
        openLoops?: string;
        emotionalContext?: string;
    };
    extractedFacts: ExtractedFact[];
}

export interface RecordingResult {
    success: boolean;
    skipped?: boolean;
    reason?: string;
    stats?: {
        messagesProcessed: number;
        estimatedTokens: number;
        factsExtracted: number;
        factsRejected: number;
        factsDuplicate: number;
    };
    error?: string;
}

// ============================================================================
// Main Processing Function
// ============================================================================

/**
 * Process memory recording for a user
 * 
 * @param userId - User ID to process
 * @param email - User email for logging
 * @returns Processing result
 */
export async function processMemoryRecording(
    userId: string,
    email: string
): Promise<RecordingResult> {
    console.log(`[Recording] Starting for user ${userId}`);

    try {
        // 1. Fetch user
        const user = await prisma.user.findUnique({
            where: { id: userId }
        });

        if (!user) {
            return { success: false, error: 'User not found' };
        }

        // 2. Get existing user-level summary
        const userSummary = await prisma.userSummary.findUnique({
            where: { userId }
        });

        const lastMessageAt = userSummary?.lastMessageAt || new Date(0);

        // 3. Fetch new messages (UNIFIED across all platforms)
        const newMessages = await prisma.conversationMessage.findMany({
            where: {
                userId,
                createdAt: { gt: lastMessageAt }
            },
            orderBy: { createdAt: 'asc' }
        });

        if (newMessages.length === 0) {
            console.log(`[Recording] No new messages for user ${userId}`);
            return { success: true, skipped: true, reason: 'No new messages' };
        }

        // 4. Estimate tokens
        const totalChars = newMessages.reduce((sum: number, m: { content: string | null }) => sum + (m.content?.length || 0), 0);
        const estimatedTokens = Math.ceil(totalChars / 4);

        console.log(`[Recording] Processing ${newMessages.length} messages (${estimatedTokens} tokens)`);

        // 5. Build prompt and call OpenAI
        const prompt = buildMemoryRecordingPrompt(
            userSummary?.summary || null,
            newMessages as ConversationMessage[]
        );

        const apiKey = user.aiApiKey || process.env.OPENAI_API_KEY;
        if (!apiKey) {
            return { success: false, error: 'No OpenAI API key available' };
        }

        const aiResponse = await callOpenAI(apiKey, prompt);

        // 6. Parse response
        let parsedResult: MemoryRecordingResult;
        try {
            const cleaned = aiResponse.trim().replace(/^```json\s*|\s*```$/g, '');
            parsedResult = JSON.parse(cleaned);
            
            // Ensure extractedFacts is an array
            if (!parsedResult.extractedFacts) {
                parsedResult.extractedFacts = [];
            }
        } catch (e) {
            console.warn('[Recording] Failed to parse AI response, using fallback');
            parsedResult = {
                summary: { compressed: aiResponse.slice(0, 500) },
                extractedFacts: []
            };
        }

        // 7. Process and store facts
        let validFactCount = 0;
        let rejectedFactCount = 0;
        let duplicateCount = 0;

        const factsToProcess = parsedResult.extractedFacts.slice(0, MAX_FACTS_PER_RECORDING);

        for (const fact of factsToProcess) {
            // Validate fact
            const validation = validateFact(fact, newMessages as ConversationMessage[]);
            if (!validation.valid) {
                console.log(`[Recording] Rejected fact: ${fact.key} - ${validation.reason}`);
                rejectedFactCount++;
                continue;
            }

            const normalizedKey = normalizeKey(fact.category, fact.key);
            const trimmedValue = fact.value.trim();

            // Check for existing fact with same key
            const existingFact = await prisma.memoryFact.findUnique({
                where: {
                    userId_key: { userId, key: normalizedKey }
                }
            });

            if (existingFact && existingFact.confidence >= fact.confidence) {
                console.log(`[Recording] Skipping duplicate: ${normalizedKey}`);
                duplicateCount++;
                continue;
            }

            // Store fact
            try {
                const memoryFact = await prisma.memoryFact.upsert({
                    where: {
                        userId_key: { userId, key: normalizedKey }
                    },
                    update: {
                        value: trimmedValue,
                        confidence: fact.confidence,
                        scope: fact.category,
                        updatedAt: new Date()
                    },
                    create: {
                        userId,
                        key: normalizedKey,
                        value: trimmedValue,
                        scope: fact.category,
                        confidence: fact.confidence,
                        sourceMessageId: newMessages[newMessages.length - 1]?.id || null
                    }
                });

                // Queue embedding (if Redis available)
                if (redis) {
                    const embeddingJob = {
                        id: `emb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                        table: 'MemoryFact',
                        recordId: memoryFact.id,
                        text: `${normalizedKey}: ${trimmedValue}`,
                        retries: 0,
                        createdAt: Date.now()
                    };
                    await redis.lpush(EMBEDDING_QUEUE_KEY, JSON.stringify(embeddingJob));
                }

                validFactCount++;
                console.log(`[Recording] Stored fact: ${normalizedKey}`);
            } catch (e) {
                console.error(`[Recording] Failed to store fact ${normalizedKey}:`, e);
            }
        }

        // 8. Format and store UserSummary
        const formattedSummary = `## Summary
${parsedResult.summary.compressed}

## Open Loops
${parsedResult.summary.openLoops || 'None'}

## Context
${parsedResult.summary.emotionalContext || 'Neutral'}`;

        const newestDate = newMessages[newMessages.length - 1].createdAt;

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

        console.log(`[Recording] Complete for user ${userId}: ${validFactCount} facts, ${rejectedFactCount} rejected, ${duplicateCount} duplicates`);

        return {
            success: true,
            stats: {
                messagesProcessed: newMessages.length,
                estimatedTokens,
                factsExtracted: validFactCount,
                factsRejected: rejectedFactCount,
                factsDuplicate: duplicateCount
            }
        };

    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[Recording] Failed for user ${userId}:`, errorMessage);
        return { success: false, error: errorMessage };
    }
}

// ============================================================================
// OpenAI API Call
// ============================================================================

async function callOpenAI(apiKey: string, prompt: string): Promise<string> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
            max_tokens: 4000
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

// ============================================================================
// Prompt Builder
// ============================================================================

function buildMemoryRecordingPrompt(
    existingSummary: string | null,
    messages: ConversationMessage[]
): string {
    const messageCount = messages.length;
    const formattedMessages = messages
        .map(m => `[${m.role.toUpperCase()}]: ${m.content}`)
        .join('\n\n');

    return `You are a Memory Recording System for a personal AI assistant.

Your job is to analyze this conversation chunk and extract TWO things:
1. A compressed summary (for context continuity)
2. ALL learnable facts about the user (for long-term memory)

---

## CONVERSATION CHUNK (${messageCount} messages)

${formattedMessages}

---

## EXISTING SUMMARY (if any)

${existingSummary || 'No prior summary.'}

---

## OUTPUT FORMAT (JSON)

{
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
  ]
}

---

## FACT EXTRACTION GUIDELINES

Extract facts in these categories:

**CONTACT** - People the user mentions
- Names, roles, relationships, email patterns

**PREFERENCE** - How the user likes things done
- Communication style, priorities, pet peeves, work habits

**CONTEXT** - Ongoing situations
- Current projects, company info, team dynamics

**BEHAVIOR** - Patterns you notice
- When they work, how they respond, habits

**DEADLINE** - Time-sensitive information
- Due dates, meetings, commitments

**RELATIONSHIP** - Dynamics between people
- Who reports to whom, tensions, alliances, communication patterns

---

## RULES

1. ONLY extract facts from USER messages (not assistant responses)
2. Include "evidence" - an exact or near-exact quote from the user
3. Set confidence based on how explicit the statement was:
   - 0.9-1.0: Explicit statement ("My boss is Sarah")
   - 0.7-0.9: Strong implication
   - 0.5-0.7: Inference (only if highly useful)
4. DO NOT extract: passwords, financial data, health info, one-time logistics
5. Extract as many genuinely useful facts as you find (up to 20)
6. Use specific, descriptive keys that won't conflict with other facts

Respond ONLY with valid JSON. No markdown code fences, no explanation.`;
}

// ============================================================================
// Fact Validation
// ============================================================================

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
        return { valid: false, reason: 'Value too short' };
    }

    // Check for sensitive content
    const sensitivePatterns = [
        /password|secret|api.?key|credit.?card|ssn|social.?security/i,
        /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,
    ];
    for (const pattern of sensitivePatterns) {
        if (pattern.test(fact.value)) {
            return { valid: false, reason: 'Contains sensitive data' };
        }
    }

    // Verify evidence appears in user messages
    if (fact.evidence && fact.evidence.length > 5) {
        const userMessages = messages
            .filter(m => m.role === 'user')
            .map(m => m.content.toLowerCase());

        const evidenceWords = fact.evidence.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        const foundWords = evidenceWords.filter(word =>
            userMessages.some(msg => msg.includes(word))
        );

        if (foundWords.length < evidenceWords.length * 0.5) {
            return { valid: false, reason: 'Evidence not found in messages' };
        }
    }

    return { valid: true };
}

// ============================================================================
// Key Normalization
// ============================================================================

function normalizeKey(category: string, key: string): string {
    const normalized = key
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '')
        .slice(0, 80);

    if (!normalized.startsWith(category)) {
        return `${category}_${normalized}`;
    }
    return normalized;
}

// ============================================================================
// Backup: Find Users Needing Recording
// ============================================================================

/**
 * Find users who have accumulated enough tokens but haven't had a recording.
 * Used by the backup cron job to catch missed triggers.
 */
export async function findUsersNeedingRecording(): Promise<{ id: string; email: string }[]> {
    const TOKEN_THRESHOLD = 120_000;
    const CHARS_PER_TOKEN = 4;
    const CHAR_THRESHOLD = TOKEN_THRESHOLD * CHARS_PER_TOKEN;

    // Find users with significant unsummarized content
    const usersWithContent = await prisma.$queryRaw<{ userId: string; totalChars: bigint }[]>`
        SELECT 
            cm."userId",
            SUM(LENGTH(cm.content)) as "totalChars"
        FROM "ConversationMessage" cm
        LEFT JOIN "UserSummary" us ON cm."userId" = us."userId"
        WHERE cm."createdAt" > COALESCE(us."lastMessageAt", '1970-01-01'::timestamp)
        GROUP BY cm."userId"
        HAVING SUM(LENGTH(cm.content)) > ${CHAR_THRESHOLD}
    `;

    if (usersWithContent.length === 0) {
        return [];
    }

    // Get user emails
    const userIds = usersWithContent.map((u: { userId: string }) => u.userId);
    const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true }
    });

    return users;
}
