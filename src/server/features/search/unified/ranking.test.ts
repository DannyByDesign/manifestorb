import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmbeddingService } from "@/features/memory/embeddings/service";
import { __testing, rankDocuments } from "@/server/features/search/unified/ranking";
import type { RankingDocument } from "@/server/features/search/unified/types";

function sampleDocs(): RankingDocument[] {
  return [
    {
      id: "email:1",
      surface: "email",
      title: "Project update",
      snippet: "Latest delivery milestone completed.",
      timestamp: "2026-02-18T10:00:00.000Z",
      metadata: {},
    },
    {
      id: "email:2",
      surface: "email",
      title: "Weekly note",
      snippet: "General team updates and reminders.",
      timestamp: "2026-02-10T10:00:00.000Z",
      metadata: {},
    },
  ];
}

describe("unified ranking semantic fail-open", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __testing.resetSemanticCircuit();
  });

  it("falls back to lexical/freshness ranking when semantic embedding fails", async () => {
    vi.spyOn(EmbeddingService, "isAvailable").mockReturnValue(true);
    vi.spyOn(EmbeddingService, "generateEmbeddings").mockRejectedValue(new Error("embedding failed"));

    const ranked = await rankDocuments({
      query: "latest project update",
      docs: sampleDocs(),
      intentHints: {
        requestedSurfaces: new Set(["email"]),
        mailbox: "inbox",
        sort: "newest",
      },
    });

    expect(ranked).toHaveLength(2);
    expect(ranked.every((item) => typeof item.semanticScore === "undefined")).toBe(true);
    expect(ranked[0]?.doc.id).toBe("email:1");
  });

  it("opens semantic circuit after repeated failures and skips further embedding attempts", async () => {
    vi.spyOn(EmbeddingService, "isAvailable").mockReturnValue(true);
    const embedSpy = vi
      .spyOn(EmbeddingService, "generateEmbeddings")
      .mockRejectedValue(new Error("provider unavailable"));

    for (let i = 0; i < 3; i += 1) {
      await rankDocuments({
        query: "project update",
        docs: sampleDocs(),
      });
    }
    await rankDocuments({
      query: "project update",
      docs: sampleDocs(),
    });

    expect(embedSpy).toHaveBeenCalledTimes(3);
  });
});
