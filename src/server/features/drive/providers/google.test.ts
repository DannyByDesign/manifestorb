import { describe, it, expect, beforeEach, vi } from "vitest";
import { GoogleDriveProvider } from "@/server/features/drive/providers/google";

const mockFilesList = vi.hoisted(() => vi.fn());

const MockOAuth2 = vi.hoisted(
  () =>
    class {
      setCredentials = vi.fn();
    },
);

vi.mock("@googleapis/drive", () => ({
  auth: {
    OAuth2: MockOAuth2,
  },
  drive: vi.fn().mockReturnValue({
    files: {
      list: mockFilesList,
    },
  }),
}));

describe("GoogleDriveProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("searchFiles returns mapped files", async () => {
    mockFilesList.mockResolvedValue({
      data: {
        files: [
          {
            id: "file-1",
            name: "Doc",
            mimeType: "application/pdf",
            size: "123",
            parents: ["root"],
            webViewLink: "http://link",
            createdTime: "2024-01-01T00:00:00Z",
          },
        ],
      },
    });

    const provider = new GoogleDriveProvider("token");
    const files = await provider.searchFiles("Doc");

    expect(files).toHaveLength(1);
    expect(files[0].id).toBe("file-1");
  });

  it("returns access token", () => {
    const provider = new GoogleDriveProvider("token-1");
    expect(provider.getAccessToken()).toBe("token-1");
  });
});
