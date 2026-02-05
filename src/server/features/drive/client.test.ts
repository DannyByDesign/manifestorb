import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getGoogleDriveOAuth2Url,
  exchangeGoogleDriveCode,
} from "@/server/features/drive/client";

const mockGenerateAuthUrl = vi.fn();
const mockGetToken = vi.fn();
const mockVerifyIdToken = vi.fn();

const MockOAuth2 = vi.hoisted(
  () =>
    class {
      generateAuthUrl = mockGenerateAuthUrl;
      getToken = mockGetToken;
      verifyIdToken = mockVerifyIdToken;
    },
);

vi.mock("@googleapis/drive", () => ({
  auth: {
    OAuth2: MockOAuth2,
  },
}));

describe("drive client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds google drive oauth url", () => {
    mockGenerateAuthUrl.mockReturnValue("http://auth");
    const url = getGoogleDriveOAuth2Url("state-1");
    expect(url).toBe("http://auth");
  });

  it("exchanges google drive code for tokens", async () => {
    mockGetToken.mockResolvedValue({
      tokens: {
        access_token: "a",
        refresh_token: "r",
        id_token: "id",
        expiry_date: Date.now(),
      },
    });
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({ email: "user@test.com" }),
    });

    const result = await exchangeGoogleDriveCode("code");
    expect(result.email).toBe("user@test.com");
    expect(result.accessToken).toBe("a");
  });
});
