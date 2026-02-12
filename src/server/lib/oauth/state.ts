import crypto from "node:crypto";

/**
 * Generates a secure OAuth state parameter
 * @param data - The data to encode in the state
 * @returns Base64URL encoded state string
 */
export function generateOAuthState<T extends Record<string, unknown>>(
  data: T & { nonce?: string },
): string {
  const stateObject = {
    ...data,
    nonce: data.nonce || crypto.randomUUID(),
  };
  return Buffer.from(JSON.stringify(stateObject)).toString("base64url");
}

/**
 * Parses an OAuth state parameter
 * @param state - Base64URL encoded state string
 * @returns The decoded state object
 * @throws Error if state is malformed or cannot be parsed
 */
export function parseOAuthState<T extends Record<string, unknown>>(
  state: string,
): T & { nonce: string } {
  try {
    const decoded = Buffer.from(state, "base64url").toString("utf8");
    return JSON.parse(decoded);
  } catch {
    throw new Error("Invalid OAuth state format");
  }
}

/**
 * Default secure cookie options for OAuth state
 */
export const oauthStateCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV !== "development",
  maxAge: 60 * 10, // 10 minutes
  path: "/",
  sameSite: "lax",
} as const;
