import { searchConversationHistory, searchMemoryFacts } from "@/features/memory/embeddings/search";
import {
  logMemoryAccessAudit,
  retrieveStructuredMemory,
  type StructuredRecallResult,
} from "@/server/features/memory/structured/service";

export type RetrievalIntent =
  | "person_recall"
  | "meeting_recall"
  | "commitment_recall"
  | "general_recall";

export interface MemoryRetrievalCitation {
  source: "memory_fact" | "conversation" | "structured";
  id: string;
  snippet: string;
}

export interface MemoryRetrievalResult {
  intent: RetrievalIntent;
  confidence: number;
  summary: string;
  citations: MemoryRetrievalCitation[];
  structured: StructuredRecallResult;
  semanticFacts: Array<{
    id: string;
    key: string;
    value: string;
    confidence: number;
    updatedAt: string;
    score: number;
    matchType: "semantic" | "keyword" | "both";
  }>;
  semanticConversation: Array<{
    id: string;
    role: string;
    content: string;
    score: number;
  }>;
}

function classifyIntent(query: string): RetrievalIntent {
  const q = query.toLowerCase();
  if (/(who|person|contact|relationship|worked with|talked to)/.test(q)) {
    return "person_recall";
  }
  if (/(meeting|calendar|event|last time we met|what did we discuss)/.test(q)) {
    return "meeting_recall";
  }
  if (/(promise|commitment|follow up|owed|deadline)/.test(q)) {
    return "commitment_recall";
  }
  return "general_recall";
}

function buildSummary(params: {
  intent: RetrievalIntent;
  structured: StructuredRecallResult;
  factsCount: number;
  conversationCount: number;
}): string {
  const people = params.structured.people.length;
  const episodes = params.structured.recentEpisodes.length;
  const commitments = params.structured.commitments.length;

  switch (params.intent) {
    case "person_recall":
      return `Found ${people} matching people, ${params.factsCount} fact hits, and ${params.conversationCount} related conversation snippets.`;
    case "meeting_recall":
      return `Found ${episodes} related episodes and ${params.conversationCount} matching conversation snippets.`;
    case "commitment_recall":
      return `Found ${commitments} related commitments and ${params.factsCount} supporting facts.`;
    default:
      return `Found ${params.factsCount} memory facts, ${params.conversationCount} conversation snippets, and ${people + episodes + commitments} structured matches.`;
  }
}

function estimateConfidence(params: {
  factsCount: number;
  conversationCount: number;
  structuredCount: number;
}): number {
  const raw =
    Math.min(params.factsCount, 4) * 0.12 +
    Math.min(params.conversationCount, 4) * 0.1 +
    Math.min(params.structuredCount, 4) * 0.13;
  return Math.min(Math.max(raw, 0.1), 0.95);
}

export async function orchestrateMemoryRetrieval(params: {
  userId: string;
  query: string;
  limit?: number;
  surface?: string;
}): Promise<MemoryRetrievalResult> {
  const limit = Math.max(1, Math.min(12, params.limit ?? 6));
  const intent = classifyIntent(params.query);

  const [structured, facts, conversations] = await Promise.all([
    retrieveStructuredMemory({
      userId: params.userId,
      query: params.query,
      limit,
    }),
    searchMemoryFacts({
      userId: params.userId,
      query: params.query,
      limit,
    }),
    searchConversationHistory({
      userId: params.userId,
      query: params.query,
      limit,
    }),
  ]);

  const semanticFacts = facts.map((result) => ({
    id: result.item.id,
    key: result.item.key,
    value: result.item.value,
    confidence: result.item.confidence,
    updatedAt: result.item.updatedAt.toISOString(),
    score: result.score,
    matchType: result.matchType,
  }));

  const semanticConversation = conversations.map((result) => ({
    id: result.item.id,
    role: result.item.role,
    content: result.item.content,
    score: result.score,
  }));

  const citations: MemoryRetrievalCitation[] = [
    ...semanticFacts.slice(0, 4).map((fact) => ({
      source: "memory_fact" as const,
      id: fact.id,
      snippet: `${fact.key}: ${fact.value}`.slice(0, 220),
    })),
    ...semanticConversation.slice(0, 4).map((message) => ({
      source: "conversation" as const,
      id: message.id,
      snippet: `[${message.role}] ${message.content}`.slice(0, 220),
    })),
    ...structured.recentEpisodes.slice(0, 2).map((episode) => ({
      source: "structured" as const,
      id: episode.id,
      snippet: episode.summary?.slice(0, 220) ?? "Episode match",
    })),
  ];

  const summary = buildSummary({
    intent,
    structured,
    factsCount: semanticFacts.length,
    conversationCount: semanticConversation.length,
  });

  const confidence = estimateConfidence({
    factsCount: semanticFacts.length,
    conversationCount: semanticConversation.length,
    structuredCount:
      structured.people.length +
      structured.recentEpisodes.length +
      structured.commitments.length,
  });

  await logMemoryAccessAudit({
    userId: params.userId,
    accessType: "orchestrated_recall",
    query: params.query,
    resultCount: citations.length,
    surface: params.surface,
    metadata: {
      intent,
      factsCount: semanticFacts.length,
      conversationCount: semanticConversation.length,
      structuredPeople: structured.people.length,
      structuredEpisodes: structured.recentEpisodes.length,
      structuredCommitments: structured.commitments.length,
    },
  });

  return {
    intent,
    confidence,
    summary,
    citations,
    structured,
    semanticFacts,
    semanticConversation,
  };
}
