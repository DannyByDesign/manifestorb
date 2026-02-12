import prisma from "@/server/db/client";
import { getGoogleOAuthConfigDiagnostics } from "@/server/lib/oauth/google-connect";

export type IntegrationStatus = {
  authenticated: boolean;
  user?: {
    id: string;
    email: string;
    name: string | null;
  };
  emailAccount?: {
    id: string;
    email: string;
    provider: string;
    disconnected: boolean;
  } | null;
  gmail: {
    connected: boolean;
    reason: string | null;
  };
  calendar: {
    connected: boolean;
    reason: string | null;
  };
  oauth: {
    baseUrl: string;
    callbackUris: {
      gmail: string;
      calendar: string;
    };
    config: {
      googleClientIdConfigured: boolean;
      googleClientSecretConfigured: boolean;
      workosRedirectConfigured: boolean;
    };
    warnings: string[];
  };
};

function buildOAuthDiagnostics(baseUrl: string) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  const { callbackUris, warnings } = getGoogleOAuthConfigDiagnostics(
    normalizedBaseUrl,
  );

  if (
    process.env.NODE_ENV === "production" &&
    !normalizedBaseUrl.startsWith("https://")
  ) {
    warnings.push("OAuth base URL must be https in production.");
  }

  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(normalizedBaseUrl)) {
    warnings.push(
      "OAuth base URL is localhost-like. This will fail in cloud environments.",
    );
  }

  return {
    baseUrl: normalizedBaseUrl,
    callbackUris,
    config: {
      googleClientIdConfigured: Boolean(process.env.GOOGLE_CLIENT_ID?.trim()),
      googleClientSecretConfigured: Boolean(
        process.env.GOOGLE_CLIENT_SECRET?.trim(),
      ),
      workosRedirectConfigured: Boolean(
        process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI?.trim(),
      ),
    },
    warnings,
  };
}

export async function getIntegrationStatusForUser(
  userId: string,
  user: { id: string; email: string; name: string | null },
  baseUrl: string,
): Promise<IntegrationStatus> {
  const emailAccount = await prisma.emailAccount.findFirst({
    where: { userId },
    select: {
      id: true,
      email: true,
      account: {
        select: {
          provider: true,
          disconnectedAt: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const oauth = buildOAuthDiagnostics(baseUrl);

  if (!emailAccount) {
    return {
      authenticated: true,
      user,
      emailAccount: null,
      gmail: {
        connected: false,
        reason: "No Gmail/Outlook account linked yet.",
      },
      calendar: {
        connected: false,
        reason: "Connect Gmail first.",
      },
      oauth,
    };
  }

  const calendarConnection = await prisma.calendarConnection.findFirst({
    where: {
      emailAccountId: emailAccount.id,
      isConnected: true,
    },
    select: { id: true },
  });

  const disconnected = Boolean(emailAccount.account.disconnectedAt);

  return {
    authenticated: true,
    user,
    emailAccount: {
      id: emailAccount.id,
      email: emailAccount.email,
      provider: emailAccount.account.provider,
      disconnected,
    },
    gmail: {
      connected: !disconnected,
      reason: disconnected
        ? "Account was disconnected. Reconnect required."
        : null,
    },
    calendar: {
      connected: Boolean(calendarConnection),
      reason: calendarConnection ? null : "Calendar is not connected.",
    },
    oauth,
  };
}
