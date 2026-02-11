"use client";

import { useState } from "react";
import { EMAIL_ACCOUNT_HEADER } from "@/server/lib/config";

type ConnectClientProps = {
  emailAccountId: string | null;
  gmailConnected: boolean;
  gmailIssue: string | null;
  calendarConnected: boolean;
  driveConnected: boolean;
};

type ConnectStatus = "idle" | "loading" | "error";

const extractErrorMessage = (payload: unknown, status: number): string => {
  if (typeof payload === "string" && payload.trim().length > 0) {
    return payload;
  }

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const nestedError = record.error;
    if (typeof nestedError === "string" && nestedError.trim().length > 0) {
      const requestId =
        typeof record.requestId === "string" ? record.requestId : null;
      return requestId
        ? `${nestedError} (requestId: ${requestId})`
        : nestedError;
    }
    if (nestedError && typeof nestedError === "object") {
      const nested = nestedError as Record<string, unknown>;
      if (typeof nested.message === "string" && nested.message.trim().length > 0) {
        return nested.message;
      }
    }
    if (
      typeof record.error_description === "string" &&
      record.error_description.trim().length > 0
    ) {
      return record.error_description;
    }
    if (typeof record.details === "string" && record.details.trim().length > 0) {
      return record.details;
    }
  }

  return `Failed to start OAuth flow (status ${status})`;
};

const requestAuthUrl = async (
  endpoint: string,
  emailAccountId: string | null,
): Promise<string> => {
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
    throw new Error("Missing OAuth URL");
  }

  return data.url;
};

export function ConnectClient({
  emailAccountId,
  gmailConnected,
  gmailIssue,
  calendarConnected,
  driveConnected,
}: ConnectClientProps) {
  const [status, setStatus] = useState<ConnectStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const hasEmailAccount = Boolean(emailAccountId);

  const startOAuth = async (endpoint: string) => {
    setStatus("loading");
    setError(null);
    try {
      const url = await requestAuthUrl(endpoint, emailAccountId);
      window.location.href = url;
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Connect your Google account</h1>
        <p className="text-sm text-gray-600">
          We use OAuth to access Gmail, Calendar, and Drive. You never paste API
          keys.
        </p>
      </header>

      <section className="rounded border border-gray-200 bg-white p-4">
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-medium">Gmail</h2>
          <p className="text-sm text-gray-600">
            Required for reading, triage, and sending emails.
          </p>
          <div className="text-xs text-gray-500">
            Status: {gmailConnected ? "connected" : "not connected"}
          </div>
          <button
            className="w-fit rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-60"
            onClick={() => startOAuth("/api/google/linking/auth-url")}
            disabled={status === "loading" || gmailConnected}
          >
            {gmailConnected
              ? "Gmail connected"
              : hasEmailAccount
                ? "Reconnect Gmail"
                : "Connect Gmail"}
          </button>
          {!gmailConnected && gmailIssue && (
            <p className="text-xs text-amber-600">
              Gmail is not fully connected: {gmailIssue}
            </p>
          )}
        </div>
      </section>

      <section className="rounded border border-gray-200 bg-white p-4">
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-medium">Calendar</h2>
          <p className="text-sm text-gray-600">
            Used to read availability and create/update events.
          </p>
          <div className="text-xs text-gray-500">
            Status: {calendarConnected ? "connected" : "not connected"}
          </div>
          <button
            className="w-fit rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-60"
            onClick={() => startOAuth("/api/google/calendar/auth-url")}
            disabled={
              status === "loading" || !emailAccountId || calendarConnected
            }
          >
            {calendarConnected ? "Calendar connected" : "Connect Calendar"}
          </button>
          {!emailAccountId && (
            <p className="text-xs text-amber-600">
              Connect Gmail first to enable Calendar linking.
            </p>
          )}
        </div>
      </section>

      <section className="rounded border border-gray-200 bg-white p-4">
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-medium">Drive</h2>
          <p className="text-sm text-gray-600">
            Optional. Needed for filing attachments and document extraction.
          </p>
          <div className="text-xs text-gray-500">
            Status: {driveConnected ? "connected" : "not connected"}
          </div>
          <button
            className="w-fit rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-60"
            onClick={() => startOAuth("/api/google/drive/auth-url")}
            disabled={status === "loading" || !emailAccountId || driveConnected}
          >
            {driveConnected ? "Drive connected" : "Connect Drive"}
          </button>
          {!emailAccountId && (
            <p className="text-xs text-amber-600">
              Connect Gmail first to enable Drive linking.
            </p>
          )}
        </div>
      </section>

      {status === "error" && error && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        className="w-fit rounded border border-gray-300 px-4 py-2 text-sm text-gray-700"
        onClick={() => window.location.reload()}
      >
        Refresh status
      </button>
    </div>
  );
}
