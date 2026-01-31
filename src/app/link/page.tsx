"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useState } from "react";

export default function LinkPage() {
    const searchParams = useSearchParams();
    const token = searchParams.get("token");
    const router = useRouter();

    const [status, setStatus] = useState<"IDLE" | "LINKING" | "SUCCESS" | "ERROR">("IDLE");
    const [errorMsg, setErrorMsg] = useState("");

    const handleLink = async () => {
        if (!token) return;
        setStatus("LINKING");

        try {
            const res = await fetch("/api/surfaces/link", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token })
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || "Failed to link account");
            }

            setStatus("SUCCESS");
        } catch (err: any) {
            console.error(err);
            setStatus("ERROR");
            setErrorMsg(err.message);
        }
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4">
            <div className="w-full max-w-md p-6 bg-white rounded-lg shadow-md border border-gray-200">
                <h1 className="text-xl font-bold mb-4">Link Account</h1>

                {!token && <div className="text-red-500">No token provided.</div>}

                {status === "IDLE" && token && (
                    <div className="flex flex-col gap-4">
                        <p>Do you want to link your Slack/Discord account to your Amodel profile?</p>
                        <button
                            onClick={handleLink}
                            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-semibold"
                        >
                            Yes, Link Account
                        </button>
                    </div>
                )}

                {status === "LINKING" && (
                    <div className="text-blue-600 animate-pulse">Linking your account...</div>
                )}

                {status === "SUCCESS" && (
                    <div className="text-green-600">
                        <h2 className="text-lg font-bold">Success! 🎉</h2>
                        <p>Your account has been linked. You can close this window and return to chat.</p>
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
