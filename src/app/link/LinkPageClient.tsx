"use client";

import { useEffect, useState } from "react";

export function LinkPageClient({ token }: { token: string | null }) {
  const [status, setStatus] = useState<
    "IDLE" | "LINKING" | "SUCCESS" | "ERROR"
  >("IDLE");
  const [errorMsg, setErrorMsg] = useState("");

  const handleLink = async () => {
    if (!token) return;
    setStatus("LINKING");

    try {
      const res = await fetch("/api/surfaces/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      const data = (await res.json()) as { error?: string };

      if (!res.ok) {
        throw new Error(data.error ?? "Failed to link account");
      }

      setStatus("SUCCESS");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to link account";
      setStatus("ERROR");
      setErrorMsg(message);
    }
  };

  // Frictionless: opening the one-time link is the confirmation.
  // We auto-link once the user is authenticated, then show success and tell them to return to chat.
  useEffect(() => {
    if (!token) return;
    void handleLink();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <div className="w-full max-w-md p-6 bg-white rounded-lg shadow-md border border-gray-200">
        <h1 className="text-xl font-bold mb-4">Link Account</h1>

        {!token && <div className="text-red-500">No token provided.</div>}

        {status === "IDLE" && token && (
          <div className="text-blue-600 animate-pulse">Linking your account...</div>
        )}

        {status === "LINKING" && (
          <div className="text-blue-600 animate-pulse">
            Linking your account...
          </div>
        )}

        {status === "SUCCESS" && (
          <div className="text-green-600">
            <h2 className="text-lg font-bold">Success! 🎉</h2>
            <p>
              Your account has been linked. You can close this window and return
              to chat.
            </p>
          </div>
        )}

        {status === "ERROR" && (
          <div className="text-red-600">
            <h2 className="text-lg font-bold">Error</h2>
            <p>{errorMsg}</p>
          </div>
        )}
      </div>
    </div>
  );
}
