"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EMAIL_ACCOUNT_HEADER } from "@/server/lib/config";

type IntegrationStatusResponse = {
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
  gmail?: {
    connected: boolean;
    reason: string | null;
  };
  calendar?: {
    connected: boolean;
    reason: string | null;
  };
  sidecars?: {
    slack?: { linked: boolean };
    discord?: { linked: boolean };
    telegram?: { linked: boolean };
  };
  oauth?: {
    baseUrl?: string;
    callbackUris?: {
      gmail: string;
      calendar: string;
    };
    config?: {
      googleClientIdConfigured: boolean;
      googleClientSecretConfigured: boolean;
      workosRedirectConfigured: boolean;
      slackClientIdConfigured: boolean;
      slackClientSecretConfigured: boolean;
    };
    warnings?: string[];
  };
};

function extractErrorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (typeof record.error === "string" && record.error.length > 0) {
      const requestId =
        typeof record.requestId === "string" ? record.requestId : null;
      return requestId
        ? `${record.error} (requestId: ${requestId})`
        : record.error;
    }
  }
  return `Request failed (status ${status})`;
}

async function requestAuthUrl(
  endpoint: string,
  emailAccountId: string | null | undefined,
): Promise<string> {
  const headers = new Headers();
  if (emailAccountId) {
    headers.set(EMAIL_ACCOUNT_HEADER, emailAccountId);
  }

  const response = await fetch(endpoint, { headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(extractErrorMessage(payload, response.status));
  }

  const data = (await response.json()) as { url?: string };
  if (!data.url) {
    throw new Error("OAuth URL was missing in response.");
  }
  return data.url;
}

async function requestSimpleAuthUrl(endpoint: string): Promise<string> {
  const response = await fetch(endpoint);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(extractErrorMessage(payload, response.status));
  }

  const data = (await response.json()) as { url?: string };
  if (!data.url) {
    throw new Error("Auth URL was missing in response.");
  }
  return data.url;
}

export function AuthConnectionPanel() {
  const [status, setStatus] = useState<IntegrationStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/integrations/status", {
        cache: "no-store",
      });
      const data = (await response.json()) as IntegrationStatusResponse;
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load status.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const warnings = useMemo(
    () => status?.oauth?.warnings?.filter(Boolean) ?? [],
    [status?.oauth?.warnings],
  );

  const startConnect = useCallback(
    async (kind: "gmail" | "calendar") => {
      if (!status?.authenticated) return;
      setConnecting(kind);
      setError(null);
      const endpoint =
        kind === "gmail"
          ? "/api/google/linking/auth-url"
          : "/api/google/calendar/auth-url";
      try {
        const authUrl = await requestAuthUrl(endpoint, status.emailAccount?.id);
        window.location.href = authUrl;
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to start OAuth flow.",
        );
        setConnecting(null);
      }
    },
    [status],
  );

  const startSlackConnect = useCallback(async () => {
    if (!status?.authenticated) return;
    setConnecting("slack");
    setError(null);
    try {
      const authUrl = await requestSimpleAuthUrl("/api/slack/install-url");
      window.location.href = authUrl;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to start Slack connect flow.",
      );
      setConnecting(null);
    }
  }, [status?.authenticated]);

  return (
    <div className="w-full max-w-md rounded-2xl border border-white/20 bg-black/40 p-4 text-sm text-white shadow-xl backdrop-blur-md">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">Amodel Status</h2>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded border border-white/30 px-2 py-1 text-xs hover:bg-white/10"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-white/80">Loading status...</p>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg border border-white/20 bg-white/5 p-2">
            <div className="font-medium">Auth</div>
            {status?.authenticated ? (
              <p className="text-white/90">
                Logged in as {status.user?.email ?? "unknown user"}
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-amber-200">Not logged in.</p>
                <a
                  href="/login?returnTo=/"
                  className="inline-block rounded bg-white px-3 py-1.5 text-black"
                >
                  Log In
                </a>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-white/20 bg-white/5 p-2">
            <div className="font-medium">Inbox (Gmail)</div>
            <p>
              {status?.gmail?.connected
                ? "Connected"
                : `Not connected${status?.gmail?.reason ? `: ${status.gmail.reason}` : ""}`}
            </p>
            {status?.authenticated && (
              <button
                type="button"
                onClick={() => void startConnect("gmail")}
                disabled={connecting !== null}
                className="mt-2 rounded bg-white px-3 py-1.5 text-black disabled:opacity-60"
              >
                {status?.gmail?.connected ? "Reconnect Gmail" : "Connect Gmail"}
              </button>
            )}
          </div>

          <div className="rounded-lg border border-white/20 bg-white/5 p-2">
            <div className="font-medium">Calendar</div>
            <p>
              {status?.calendar?.connected
                ? "Connected"
                : `Not connected${status?.calendar?.reason ? `: ${status.calendar.reason}` : ""}`}
            </p>
            {status?.authenticated && (
              <button
                type="button"
                onClick={() => void startConnect("calendar")}
                disabled={connecting !== null || !status?.emailAccount?.id}
                className="mt-2 rounded bg-white px-3 py-1.5 text-black disabled:opacity-60"
              >
                {status?.calendar?.connected
                  ? "Reconnect Calendar"
                  : "Connect Calendar"}
              </button>
            )}
          </div>

          <div className="rounded-lg border border-white/20 bg-white/5 p-2">
            <div className="font-medium">Sidecars</div>
            <p>
              Slack:{" "}
              {status?.sidecars?.slack?.linked ? "Linked" : "Not linked"}
            </p>
            <p>
              Discord:{" "}
              {status?.sidecars?.discord?.linked ? "Linked" : "Not linked"}
            </p>
            <p>
              Telegram:{" "}
              {status?.sidecars?.telegram?.linked ? "Linked" : "Not linked"}
            </p>
            {status?.authenticated && (
              <button
                type="button"
                onClick={() => void startSlackConnect()}
                disabled={connecting !== null || status?.sidecars?.slack?.linked}
                className="mt-2 rounded bg-white px-3 py-1.5 text-black disabled:opacity-60"
              >
                {status?.sidecars?.slack?.linked ? "Slack Connected" : "Connect Slack"}
              </button>
            )}
            <p className="mt-2 text-white/70">
              Tip: DM the Amodel bot in your sidecar app. If you are not linked yet, it will send a one-time connect link.
            </p>
          </div>

          {warnings.length > 0 && (
            <div className="rounded-lg border border-amber-400/50 bg-amber-400/10 p-2 text-amber-100">
              <div className="font-medium">OAuth config warning</div>
              {warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          )}

          {status?.oauth?.config && (
            <div className="rounded-lg border border-white/20 bg-white/5 p-2">
              <div className="font-medium">OAuth config checks</div>
              <p>
                GOOGLE_CLIENT_ID:{" "}
                {status.oauth.config.googleClientIdConfigured
                  ? "configured"
                  : "missing"}
              </p>
              <p>
                GOOGLE_CLIENT_SECRET:{" "}
                {status.oauth.config.googleClientSecretConfigured
                  ? "configured"
                  : "missing"}
              </p>
              <p>
                WORKOS redirect URI:{" "}
                {status.oauth.config.workosRedirectConfigured
                  ? "configured"
                  : "missing"}
              </p>
              <p>
                SLACK_CLIENT_ID:{" "}
                {status.oauth.config.slackClientIdConfigured
                  ? "configured"
                  : "missing"}
              </p>
              <p>
                SLACK_CLIENT_SECRET:{" "}
                {status.oauth.config.slackClientSecretConfigured
                  ? "configured"
                  : "missing"}
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-400/50 bg-red-400/10 p-2 text-red-100">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
