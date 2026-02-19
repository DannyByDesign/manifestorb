import { auth, gmail, type gmail_v1 } from "@googleapis/gmail";
import { people } from "@googleapis/people";
import { saveTokens } from "@/server/auth";
import { cleanupInvalidTokens } from "@/server/auth/cleanup-invalid-tokens";
import { env } from "@/env";
import type { Logger } from "@/server/lib/logger";
import { SCOPES } from "@/server/integrations/google/scopes";
import { SafeError } from "@/server/lib/error";

type AuthOptions = {
  accessToken?: string | null;
  refreshToken?: string | null;
  expiryDate?: number | null;
  expiresAt?: number | null;
};

type OAuthErrorData = {
  error?: string;
  error_description?: string;
};

function getOAuthErrorData(error: unknown): OAuthErrorData | null {
  if (!error || typeof error !== "object") return null;
  const response = (error as { response?: { data?: unknown } }).response;
  if (!response || typeof response !== "object") return null;
  const data = response.data;
  if (!data || typeof data !== "object") return null;
  return data as OAuthErrorData;
}

function isInvalidGrantError(error: unknown): boolean {
  const code = getOAuthErrorData(error)?.error;
  if (code) return code === "invalid_grant";
  return error instanceof Error && error.message.trim() === "invalid_grant";
}

const getAuth = ({
  accessToken,
  refreshToken,
  expiresAt,
  ...rest
}: AuthOptions) => {
  const expiryDate = expiresAt ? expiresAt : rest.expiryDate;

  const googleAuth = new auth.OAuth2({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  });
  googleAuth.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: expiryDate,
    scope: SCOPES.join(" "),
  });

  return googleAuth;
};

export function getLinkingOAuth2Client() {
  return getLinkingOAuth2ClientForBaseUrl(env.NEXT_PUBLIC_BASE_URL);
}

export function getLinkingOAuth2ClientForBaseUrl(baseUrl: string) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  return new auth.OAuth2({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: `${normalizedBaseUrl}/api/google/linking/callback`,
  });
}

// we should potentially use this everywhere instead of getGmailClient as this handles refreshing the access token and saving it to the db
export const getGmailClientWithRefresh = async ({
  accessToken,
  refreshToken,
  expiresAt,
  emailAccountId,
  logger,
}: {
  accessToken?: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  emailAccountId: string;
  logger: Logger;
}): Promise<gmail_v1.Gmail> => {
  if (!refreshToken) {
    logger.error("No refresh token", { emailAccountId });
    throw new SafeError("No refresh token");
  }

  // we handle refresh ourselves so not passing in expiresAt
  const auth = getAuth({ accessToken, refreshToken });
  const g = gmail({ version: "v1", auth });

  const expiryDate = expiresAt ? expiresAt : null;
  if (expiryDate && expiryDate > Date.now()) return g;

  // may throw `invalid_grant` error
  try {
    const tokens = await auth.refreshAccessToken();
    const newAccessToken = tokens.credentials.access_token;

    if (newAccessToken !== accessToken) {
      await saveTokens({
        tokens: {
          access_token: newAccessToken ?? undefined,
          expires_at: tokens.credentials.expiry_date
            ? Math.floor(tokens.credentials.expiry_date / 1000)
            : undefined,
        },
        accountRefreshToken: refreshToken,
        emailAccountId,
        provider: "google",
      });
    }

    return g;
  } catch (error) {
    const invalidGrant = isInvalidGrantError(error);

    if (invalidGrant) {
      logger.warn("Error refreshing Gmail access token", {
        emailAccountId,
        error: error instanceof Error ? error.message : String(error),
        errorDescription: getOAuthErrorData(error)?.error_description,
      });

      const cleanup = await cleanupInvalidTokens({
        emailAccountId,
        reason: "invalid_grant",
        logger,
      });

      if (cleanup.status === "deferred") {
        throw new SafeError(
          "Gmail authentication failed while refreshing access. Please try again. If this keeps happening, reconnect your account in the Amodel web app.",
        );
      }

      throw new SafeError(
        "Your Gmail connection has expired. Please reconnect your account in the Amodel web app.",
      );
    }

    throw error;
  }
};

// doesn't handle refreshing the access token
// should probably use the same auth object as getGmailClientWithRefresh but not critical for now
// doesn't handle refreshing the access token
// should probably use the same auth object as getGmailClientWithRefresh but not critical for now
export const getContactsClient = ({
  accessToken,
  refreshToken,
}: AuthOptions) => {
  const auth = getAuth({ accessToken, refreshToken });
  const contacts = people({ version: "v1", auth });

  return contacts;
};

export const getContactsClientWithRefresh = async ({
  accessToken,
  refreshToken,
  expiresAt,
  emailAccountId,
  logger,
}: {
  accessToken?: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  emailAccountId: string;
  logger: Logger;
}) => {
  if (!refreshToken) {
    logger.error("No refresh token", { emailAccountId });
    throw new SafeError("No refresh token");
  }

  const auth = getAuth({ accessToken, refreshToken });
  const contacts = people({ version: "v1", auth });

  const expiryDate = expiresAt ? expiresAt : null;
  if (expiryDate && expiryDate > Date.now()) return contacts;

  try {
    const tokens = await auth.refreshAccessToken();
    const newAccessToken = tokens.credentials.access_token;

    if (newAccessToken !== accessToken) {
      await saveTokens({
        tokens: {
          access_token: newAccessToken ?? undefined,
          expires_at: tokens.credentials.expiry_date
            ? Math.floor(tokens.credentials.expiry_date / 1000)
            : undefined,
        },
        accountRefreshToken: refreshToken,
        emailAccountId,
        provider: "google",
      });
    }

    return contacts;
  } catch (error) {
    const invalidGrant = isInvalidGrantError(error);

    if (invalidGrant) {
      logger.warn("Error refreshing Google Contacts access token", {
        emailAccountId,
        error: error instanceof Error ? error.message : String(error),
      });

      const cleanup = await cleanupInvalidTokens({
        emailAccountId,
        reason: "invalid_grant",
        logger,
      });

      if (cleanup.status === "deferred") {
        throw new SafeError(
          "Google authentication failed while refreshing access. Please try again. If this keeps happening, reconnect your account in the Amodel web app.",
        );
      }

      throw new SafeError(
        "Your Gmail connection has expired. Please reconnect your account in the Amodel web app.",
      );
    }

    throw error;
  }
};

export const getAccessTokenFromClient = (client: gmail_v1.Gmail): string => {
  const auth = client.context._options.auth as
    | { credentials?: { access_token?: string | null } }
    | undefined;
  const accessToken = auth?.credentials?.access_token;
  if (!accessToken) throw new Error("No access token");
  return accessToken;
};

export const getGmailClient = ({ accessToken }: { accessToken: string }) => {
  const auth = getAuth({ accessToken });
  return gmail({ version: "v1", auth });
};
