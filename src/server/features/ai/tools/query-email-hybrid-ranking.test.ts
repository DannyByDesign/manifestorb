import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ default: {} }));
vi.mock("@/server/lib/user/get", () => ({
  getEmailAccountWithAi: vi.fn(),
}));
vi.mock("@/features/memory/embeddings/service", () => ({
  EmbeddingService: {
    isAvailable: vi.fn().mockReturnValue(false),
    generateEmbeddings: vi.fn(),
    cosineSimilarity: vi.fn(),
  },
}));

import { queryTool } from "./query";

describe("queryTool email hybrid ranking", () => {
  it("uses lexical reranking for natural-language text queries", async () => {
    const search = vi.fn().mockResolvedValue({
      messages: [
        {
          id: "m-1",
          threadId: "t-1",
          snippet: "Notes from the team offsite",
          historyId: "h-1",
          inline: [],
          headers: {
            subject: "Offsite notes",
            from: "ops@example.com",
            to: "me@example.com",
            date: "2026-02-08T00:00:00.000Z",
          },
          subject: "Offsite notes",
          date: "2026-02-08T00:00:00.000Z",
        },
        {
          id: "m-2",
          threadId: "t-2",
          snippet: "Please delete the E2E cleanup tests",
          historyId: "h-2",
          inline: [],
          headers: {
            subject: "E2E cleanup reminder",
            from: "me@example.com",
            to: "me@example.com",
            date: "2026-02-08T01:00:00.000Z",
          },
          subject: "E2E cleanup reminder",
          date: "2026-02-08T01:00:00.000Z",
        },
      ],
      nextPageToken: undefined,
      totalEstimate: 2,
    });

    const result = await queryTool.execute(
      {
        resource: "email",
        filter: {
          text: "E2E cleanup",
          limit: 1,
        },
      },
      {
        userId: "user-1",
        emailAccountId: "email-1",
        providers: { email: { search } },
        logger: { warn: vi.fn() },
      } as unknown as Parameters<typeof queryTool.execute>[1],
    );

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 60,
      }),
    );
    expect(result.success).toBe(true);
    const rows = (result.data as Array<{ id?: string }>) ?? [];
    expect(rows[0]?.id).toBe("m-2");
  });
});
