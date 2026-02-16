import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma, { resetPrismaMock } from "@/server/lib/__mocks__/prisma";
import { searchConversationHistory, searchMemoryFacts } from "@/features/memory/embeddings/search";
import { EmbeddingService } from "@/features/memory/embeddings/service";

vi.mock("@/server/db/client");
vi.mock("@/features/memory/embeddings/service", () => ({
  EmbeddingService: {
    isAvailable: vi.fn(),
    generateEmbedding: vi.fn(),
  },
}));

describe("hybrid memory search", () => {
  beforeEach(() => {
    resetPrismaMock();
    vi.clearAllMocks();
  });

  it("falls back to keyword search when semantic query fails", async () => {
    vi.mocked(EmbeddingService.isAvailable).mockReturnValue(true);
    vi.mocked(EmbeddingService.generateEmbedding).mockResolvedValue([0.1, 0.2, 0.3]);

    prisma.$queryRaw
      .mockResolvedValueOnce([{ exists: true }] as never)
      .mockRejectedValueOnce(new Error("vector operator unavailable"));
    prisma.$queryRawUnsafe.mockResolvedValue([{ embedding: null }] as never);

    prisma.memoryFact.findMany.mockResolvedValue([
      {
        id: "fact-1",
        key: "contact_sam",
        value: "Sam from Acme",
        confidence: 0.9,
        updatedAt: new Date("2026-02-16T00:00:00.000Z"),
        userId: "user-1",
      },
    ] as never);

    const result = await searchMemoryFacts({
      userId: "user-1",
      query: "sam acme",
      limit: 5,
    });

    expect(result.length).toBe(1);
    expect(result[0]?.matchType).toBe("keyword");
  });

  it("returns empty conversation results when vector extension is unavailable", async () => {
    vi.mocked(EmbeddingService.isAvailable).mockReturnValue(true);
    prisma.$queryRaw.mockResolvedValue([{ exists: false }] as never);

    const result = await searchConversationHistory({
      userId: "user-1",
      query: "latest notes",
      limit: 5,
    });

    expect(result).toEqual([]);
    expect(EmbeddingService.generateEmbedding).not.toHaveBeenCalled();
  });
});
