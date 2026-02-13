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

type CanonicalRuleItem = {
  id: string;
  type: "guardrail" | "automation" | "preference";
  name?: string;
  description?: string;
  enabled: boolean;
  priority: number;
  source: { mode: string };
  match: { resource: string; operation?: string };
};

type RulePlaneResponse = {
  rules: CanonicalRuleItem[];
  summary: {
    total: number;
    guardrails: number;
    automations: number;
    preferences: number;
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
  const [rulePlane, setRulePlane] = useState<RulePlaneResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [ruleInput, setRuleInput] = useState("");
  const [ruleCompilerNote, setRuleCompilerNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusResponse, rulesResponse] = await Promise.all([
        fetch("/api/integrations/status", { cache: "no-store" }),
        fetch("/api/rule-plane", { cache: "no-store" }),
      ]);
      const statusData = (await statusResponse.json()) as IntegrationStatusResponse;
      setStatus(statusData);

      if (rulesResponse.ok) {
        const rulesData = (await rulesResponse.json()) as RulePlaneResponse;
        setRulePlane(rulesData);
      }
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

  const disconnectSlack = useCallback(async () => {
    if (!status?.authenticated) return;
    setConnecting("slack-disconnect");
    setError(null);
    try {
      const response = await fetch("/api/slack/disconnect", {
        method: "POST",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(extractErrorMessage(payload, response.status));
      }
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to disconnect Slack.",
      );
    } finally {
      setConnecting(null);
    }
  }, [refresh, status?.authenticated]);

  const previewRule = useCallback(async () => {
    if (!status?.authenticated || !ruleInput.trim()) return;
    setConnecting("rule-preview");
    setRuleCompilerNote(null);
    setError(null);
    try {
      const response = await fetch("/api/rule-plane/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: ruleInput }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(extractErrorMessage(payload, response.status));
      }
      const compiled = payload?.compiled as
        | {
            explanation?: string;
            needsClarification?: boolean;
            clarificationPrompt?: string;
            diagnostics?: { confidence?: number; warnings?: string[] };
          }
        | undefined;
      const confidence =
        typeof compiled?.diagnostics?.confidence === "number"
          ? compiled.diagnostics.confidence.toFixed(2)
          : "n/a";
      const warnings = Array.isArray(compiled?.diagnostics?.warnings)
        ? compiled?.diagnostics?.warnings?.join("; ")
        : "";
      const prompt =
        compiled?.needsClarification && compiled?.clarificationPrompt
          ? ` Clarification: ${compiled.clarificationPrompt}`
          : "";
      const warningText = warnings ? ` Warnings: ${warnings}` : "";
      setRuleCompilerNote(
        `${compiled?.explanation ?? "Compiled preview."} (confidence ${confidence}).${warningText}${prompt}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to preview rule.");
    } finally {
      setConnecting(null);
    }
  }, [ruleInput, status?.authenticated]);

  const activateRule = useCallback(async () => {
    if (!status?.authenticated || !ruleInput.trim()) return;
    setConnecting("rule-activate");
    setRuleCompilerNote(null);
    setError(null);
    try {
      const response = await fetch("/api/rule-plane", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "compile",
          input: ruleInput,
          activate: true,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(extractErrorMessage(payload, response.status));
      }
      if (payload?.activated) {
        setRuleCompilerNote("Rule activated.");
        setRuleInput("");
      } else {
        const compiled = payload?.compiled as
          | {
              explanation?: string;
              clarificationPrompt?: string;
            }
          | undefined;
        setRuleCompilerNote(
          `${compiled?.explanation ?? "Rule draft needs clarification."}${compiled?.clarificationPrompt ? ` ${compiled.clarificationPrompt}` : ""}`,
        );
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to activate rule.");
    } finally {
      setConnecting(null);
    }
  }, [refresh, ruleInput, status?.authenticated]);

  const deleteRule = useCallback(
    async (ruleId: string) => {
      if (!status?.authenticated) return;
      setConnecting(`rule-delete:${ruleId}`);
      setError(null);
      try {
        const response = await fetch(`/api/rule-plane/${ruleId}`, {
          method: "DELETE",
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(extractErrorMessage(payload, response.status));
        }
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete rule.");
      } finally {
        setConnecting(null);
      }
    },
    [refresh, status?.authenticated],
  );

  return (
    <div className="max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-white/20 bg-black/40 p-4 text-sm text-white shadow-xl backdrop-blur-md">
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
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => void startSlackConnect()}
                  disabled={connecting !== null || status?.sidecars?.slack?.linked}
                  className="rounded bg-white px-3 py-1.5 text-black disabled:opacity-60"
                >
                  {status?.sidecars?.slack?.linked
                    ? "Slack Connected"
                    : "Connect Slack"}
                </button>
                {status?.sidecars?.slack?.linked && (
                  <button
                    type="button"
                    onClick={() => void disconnectSlack()}
                    disabled={connecting !== null}
                    className="rounded border border-red-300 bg-red-500/20 px-3 py-1.5 text-red-100 disabled:opacity-60"
                  >
                    Disconnect Slack
                  </button>
                )}
              </div>
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

          {status?.authenticated && (
            <div className="rounded-lg border border-white/20 bg-white/5 p-2">
              <div className="font-medium">Rule Plane (Unified)</div>
              <p className="text-white/80">
                Guardrails: {rulePlane?.summary.guardrails ?? 0} | Automations:{" "}
                {rulePlane?.summary.automations ?? 0} | Preferences:{" "}
                {rulePlane?.summary.preferences ?? 0}
              </p>
              <textarea
                value={ruleInput}
                onChange={(event) => setRuleInput(event.target.value)}
                placeholder="Example: Always require approval before deleting calendar events."
                className="mt-2 h-20 w-full rounded border border-white/20 bg-black/30 p-2 text-xs text-white placeholder:text-white/50"
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => void previewRule()}
                  disabled={connecting !== null || !ruleInput.trim()}
                  className="rounded border border-white/30 px-2 py-1 text-xs disabled:opacity-60"
                >
                  Preview
                </button>
                <button
                  type="button"
                  onClick={() => void activateRule()}
                  disabled={connecting !== null || !ruleInput.trim()}
                  className="rounded bg-white px-2 py-1 text-xs text-black disabled:opacity-60"
                >
                  Activate
                </button>
              </div>
              {ruleCompilerNote && (
                <p className="mt-2 text-xs text-emerald-100">{ruleCompilerNote}</p>
              )}
              <div className="mt-3 space-y-1">
                {(rulePlane?.rules ?? []).map((rule) => (
                  <div
                    key={rule.id}
                    className="rounded border border-white/10 bg-black/20 p-2 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">
                        [{rule.type}] {rule.name ?? rule.id}
                      </span>
                      {rule.id.startsWith("legacy-") ? (
                        <span className="text-white/60">legacy</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void deleteRule(rule.id)}
                          disabled={connecting !== null}
                          className="rounded border border-red-300/50 px-1.5 py-0.5 text-[10px] text-red-100 disabled:opacity-60"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                    <p className="text-white/70">
                      {rule.match.resource}
                      {rule.match.operation ? ` / ${rule.match.operation}` : ""}
                      {rule.enabled ? "" : " (disabled)"}
                    </p>
                  </div>
                ))}
              </div>
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
