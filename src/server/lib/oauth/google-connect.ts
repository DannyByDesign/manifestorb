import { auth } from "@googleapis/gmail";
import { GOOGLE_DRIVE_SCOPES } from "@/features/drive/scopes";
import { CALENDAR_SCOPES } from "@/server/integrations/google/scopes";
import { SafeError } from "@/server/lib/error";

export type GoogleOAuthKind = "gmail" | "calendar" | "drive";

const GOOGLE_LINKING_SCOPES_BASE = [
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.settings.basic",
] as const;

const GOOGLE_OAUTH_REDIRECT_PATH: Record<GoogleOAuthKind, string> = {
  gmail: "/api/google/linking/callback",
  calendar: "/api/google/calendar/callback",
  drive: "/api/google/drive/callback",
};

function parseBooleanEnv(value?: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function getGoogleOAuthScopes(kind: GoogleOAuthKind): string[] {
  if (kind === "calendar") return [...CALENDAR_SCOPES];
  if (kind === "drive") return [...GOOGLE_DRIVE_SCOPES];

  const scopes: string[] = [...GOOGLE_LINKING_SCOPES_BASE];
  if (parseBooleanEnv(process.env.NEXT_PUBLIC_CONTACTS_ENABLED)) {
    scopes.push("https://www.googleapis.com/auth/contacts");
  }
  // OpenID + email are needed for identity claims on callback.
  scopes.push("openid", "email");
  return [...new Set(scopes)];
}

export function getGoogleOAuthRedirectUri(
  kind: GoogleOAuthKind,
  baseUrl: string,
): string {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  return `${normalizedBaseUrl}${GOOGLE_OAUTH_REDIRECT_PATH[kind]}`;
}

export function getGoogleOAuthConfigDiagnostics(baseUrl: string): {
  callbackUris: Record<GoogleOAuthKind, string>;
  warnings: string[];
} {
  const callbackUris = {
    gmail: getGoogleOAuthRedirectUri("gmail", baseUrl),
    calendar: getGoogleOAuthRedirectUri("calendar", baseUrl),
    drive: getGoogleOAuthRedirectUri("drive", baseUrl),
  };

  const warnings: string[] = [];
  if (!process.env.GOOGLE_CLIENT_ID?.trim()) {
    warnings.push("Missing GOOGLE_CLIENT_ID.");
  }
  if (!process.env.GOOGLE_CLIENT_SECRET?.trim()) {
    warnings.push("Missing GOOGLE_CLIENT_SECRET.");
  }

  const workosRedirectUri = process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI?.trim();
  if (!workosRedirectUri) {
    warnings.push("Missing NEXT_PUBLIC_WORKOS_REDIRECT_URI.");
  } else if (!workosRedirectUri.startsWith("https://")) {
    warnings.push("NEXT_PUBLIC_WORKOS_REDIRECT_URI should use https.");
  }

  if (!baseUrl.startsWith("https://") && process.env.NODE_ENV === "production") {
    warnings.push("OAuth base URL should use https in production.");
  }

  return { callbackUris, warnings };
}

function getGoogleOAuthCredentials(): {
  clientId: string;
  clientSecret: string;
} {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    const missing = [
      !clientId ? "GOOGLE_CLIENT_ID" : null,
      !clientSecret ? "GOOGLE_CLIENT_SECRET" : null,
    ]
      .filter(Boolean)
      .join(", ");
    throw new SafeError(
      `Google OAuth is not configured. Missing: ${missing}.`,
      500,
    );
  }

  return { clientId, clientSecret };
}

export function generateGoogleOAuthUrl({
  kind,
  baseUrl,
  state,
}: {
  kind: GoogleOAuthKind;
  baseUrl: string;
  state: string;
}): string {
  const { clientId, clientSecret } = getGoogleOAuthCredentials();
  const redirectUri = getGoogleOAuthRedirectUri(kind, baseUrl);

  const oauth2Client = new auth.OAuth2({
    clientId,
    clientSecret,
    redirectUri,
  });

  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: getGoogleOAuthScopes(kind),
    prompt: "consent",
    state,
  });
}
