import { SCOPES } from "@/server/integrations/google/scopes";
import {
  getAccessTokenFromClient,
  getGmailClientWithRefresh,
} from "@/server/integrations/google/client";
import { createScopedLogger } from "@/server/lib/logger";
import { cleanupInvalidTokens } from "@/server/auth/cleanup-invalid-tokens";

const logger = createScopedLogger("Gmail Permissions");

async function checkGmailPermissions({
  accessToken,
  emailAccountId,
}: {
  accessToken: string;
  emailAccountId: string;
}): Promise<{
  hasAllPermissions: boolean;
  missingScopes: string[];
  error?: string;
}> {
  if (!accessToken) {
    logger.error("No access token available", { emailAccountId });
    return {
      hasAllPermissions: false,
      missingScopes: SCOPES,
      error: "No access token available",
    };
  }

  try {
    const response = await fetch(
      `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${accessToken}`,
    );

    if (!response.ok) {
      const text = await response.text();
      let error = `Google API Error: ${response.status} ${response.statusText}`;
      try {
        const data = JSON.parse(text);
        if (data.error) error = data.error;
        if (data.error_description) error += `: ${data.error_description}`;
      } catch {
        // ignore JSON parse error, use text/status
      }

      logger.error("Google Token Info Failed", { emailAccountId, status: response.status, body: text });
      return {
        hasAllPermissions: false,
        missingScopes: SCOPES,
        error,
      };
    }

    const data = await response.json();

    if (data.error) {
      logger.error("Invalid token or Google API error", {
        emailAccountId,
        error: data.error,
      });
      return {
        hasAllPermissions: false,
        missingScopes: SCOPES,
        error: data.error,
      };
    }

    const grantedScopes = data.scope?.split(" ") || [];
    const missingScopes = SCOPES.filter(
      (scope) => !grantedScopes.includes(scope),
    );

    const hasAllPermissions = missingScopes.length === 0;

    if (!hasAllPermissions)
      logger.info("Missing Gmail permissions", {
        emailAccountId,
        missingScopes,
      });

    return { hasAllPermissions, missingScopes };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Error checking Gmail permissions", { emailAccountId, error: message });
    return {
      hasAllPermissions: false,
      missingScopes: SCOPES,
      error: "Failed to check permissions due to network or server error",
    };
  }
}

export async function handleGmailPermissionsCheck({
  accessToken,
  refreshToken,
  emailAccountId,
}: {
  accessToken: string;
  refreshToken: string | null | undefined;
  emailAccountId: string;
}) {
  const permissionsBeforeRefresh = await checkGmailPermissions({
    accessToken,
    emailAccountId,
  });

  if (
    permissionsBeforeRefresh.error &&
    [
      "invalid_token",
      "invalid_grant",
      "invalid_scope",
      "access_denied",
    ].includes(permissionsBeforeRefresh.error)
  ) {
    // attempt to refresh the token one last time using only the refresh token
    if (refreshToken) {
      try {
        const gmailClient = await getGmailClientWithRefresh({
          accessToken: null,
          refreshToken,
          // force refresh even if existing expiry suggests it's valid
          expiresAt: null,
          emailAccountId,
          logger,
        });

        // re-check permissions with the new access token
        const accessToken = getAccessTokenFromClient(gmailClient);
        const permissionsAfterRefresh = await checkGmailPermissions({
          accessToken,
          emailAccountId,
        });

        if (
          permissionsAfterRefresh.error &&
          permissionsAfterRefresh.error === "invalid_grant"
        ) {
          logger.info("Handling invalid Gmail grant after refresh retry", {
            emailAccountId,
          });
          const cleanup = await cleanupInvalidTokens({
            emailAccountId,
            reason: "invalid_grant",
            logger,
          });

          if (cleanup.status === "deferred") {
            return {
              hasAllPermissions: false,
              error:
                "Gmail authorization refresh failed. Please try again. If this keeps happening, reconnect your account.",
              missingScopes: permissionsBeforeRefresh.missingScopes,
            };
          }

          return {
            hasAllPermissions: false,
            error: "Gmail access expired. Please reconnect your account.",
            missingScopes: permissionsBeforeRefresh.missingScopes,
          };
        }

        return permissionsAfterRefresh;
      } catch (error) {
        return {
          hasAllPermissions: false,
          error:
            error instanceof Error
              ? error.message
              : "Gmail access expired. Please reconnect your account.",
          missingScopes: permissionsBeforeRefresh.missingScopes,
        };
      }
    } else {
      logger.warn("Got no refresh token to attempt refresh", {
        emailAccountId,
      });
    }
  }

  return permissionsBeforeRefresh;
}
