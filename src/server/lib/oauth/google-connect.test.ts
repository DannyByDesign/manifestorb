import { afterEach, describe, expect, it, vi } from "vitest";
import { SafeError } from "@/server/lib/error";
import {
  generateGoogleOAuthUrl,
  getGoogleOAuthConfigDiagnostics,
} from "./google-connect";

const ORIGINAL_ENV = {
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  NEXT_PUBLIC_WORKOS_REDIRECT_URI: process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI,
  NODE_ENV: process.env.NODE_ENV,
};

afterEach(() => {
  process.env.GOOGLE_CLIENT_ID = ORIGINAL_ENV.GOOGLE_CLIENT_ID;
  process.env.GOOGLE_CLIENT_SECRET = ORIGINAL_ENV.GOOGLE_CLIENT_SECRET;
  process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI =
    ORIGINAL_ENV.NEXT_PUBLIC_WORKOS_REDIRECT_URI;
  (process.env as Record<string, string | undefined>).NODE_ENV =
    ORIGINAL_ENV.NODE_ENV;
  vi.restoreAllMocks();
});

describe("google-connect", () => {
  it("throws a SafeError when Google OAuth env is missing", () => {
    process.env.GOOGLE_CLIENT_ID = "";
    process.env.GOOGLE_CLIENT_SECRET = "";

    expect(() =>
      generateGoogleOAuthUrl({
        kind: "gmail",
        baseUrl: "https://web-production-d642.up.railway.app",
        state: "state-1",
      }),
    ).toThrowError(SafeError);
  });

  it("returns warnings for missing config", () => {
    process.env.GOOGLE_CLIENT_ID = "";
    process.env.GOOGLE_CLIENT_SECRET = "";
    process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI = "";
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";

    const diagnostics = getGoogleOAuthConfigDiagnostics(
      "http://localhost:3000",
    );

    expect(diagnostics.warnings).toEqual(
      expect.arrayContaining([
        "Missing GOOGLE_CLIENT_ID.",
        "Missing GOOGLE_CLIENT_SECRET.",
        "Missing NEXT_PUBLIC_WORKOS_REDIRECT_URI.",
        "OAuth base URL should use https in production.",
      ]),
    );
  });
});
