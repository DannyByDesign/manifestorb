"use client";

import { useState } from "react";

const GOOGLE_FORM_ACTION_URL =
  process.env.NEXT_PUBLIC_GOOGLE_FORM_ACTION_URL ?? "";
const GOOGLE_FORM_EMAIL_FIELD_ID =
  process.env.NEXT_PUBLIC_GOOGLE_FORM_EMAIL_FIELD_ID ?? "";

export function EmailCaptureOverlay() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">(
    "idle",
  );
  const [message, setMessage] = useState("");

  async function submitEmail(value: string) {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return;

    if (!GOOGLE_FORM_ACTION_URL || !GOOGLE_FORM_EMAIL_FIELD_ID) {
      setStatus("error");
      setMessage("Signups are temporarily unavailable.");
      return;
    }

    setStatus("submitting");
    setMessage("");

    try {
      const body = new URLSearchParams({
        [GOOGLE_FORM_EMAIL_FIELD_ID]: normalized,
      });

      // Google Forms submissions from browser require no-cors mode.
      await fetch(GOOGLE_FORM_ACTION_URL, {
        method: "POST",
        mode: "no-cors",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: body.toString(),
      });

      setStatus("success");
      setMessage("Thanks. Your email has been received.");
      setEmail("");
    } catch {
      setStatus("error");
      setMessage("Could not submit right now. Please try again.");
    }
  }

  return (
    <section className="landing-overlay-enter pointer-events-none absolute inset-0 z-20 flex items-end justify-center px-5 pb-40 md:pb-52">
      <div className="pointer-events-auto w-full max-w-2xl text-center">
        <p className="font-[family-name:var(--font-body)] text-[10px] tracking-[0.2em] text-[#5E4A90]/82 uppercase">
          SIGN UP FOR EARLY ACCESS
        </p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-[1.9rem] leading-[1.08] text-[#3B2B66] md:text-[2.8rem]">
          Amodel, the only way to manage your inbox and calendar.
        </h1>

        <form
          className="mt-5 w-full"
          onSubmit={async (event) => {
            event.preventDefault();
            await submitEmail(email);
          }}
        >
          <label htmlFor="waitlist-email" className="sr-only">
            Email address
          </label>
          <div className="relative mx-auto max-w-md">
            <input
              id="waitlist-email"
              name="email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              disabled={status === "submitting"}
              className="h-11 w-full rounded-full border border-[#CFBEE8] bg-white/72 px-4 pr-14 font-[family-name:var(--font-body)] text-sm text-[#2F2354] outline-none backdrop-blur-sm transition focus:border-[#8C6FD6] focus:ring-4 focus:ring-[#B89EF3]/30"
            />
            <button
              type="submit"
              aria-label="Join waitlist"
              disabled={status === "submitting"}
              className="absolute top-1/2 right-1 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-[#6D4AC5] text-white shadow-[0_6px_14px_rgba(77,48,153,0.45)] transition hover:bg-[#5C3DB1] focus:ring-4 focus:ring-[#A78AF0]/40 focus:outline-none"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
              >
                <path
                  d="M5 12H19M19 12L13 6M19 12L13 18"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </form>

        <p
          className={`mt-2 h-5 overflow-hidden text-ellipsis whitespace-nowrap font-[family-name:var(--font-body)] text-[11px] leading-5 transition-opacity ${
            status === "error" ? "text-[#7A2844]" : "text-[#56447D]/80"
          } ${status === "idle" ? "opacity-0" : "opacity-100"}`}
          aria-live="polite"
        >
          {status === "idle" ? "\u00A0" : status === "submitting" ? "Submitting..." : message}
        </p>
      </div>
    </section>
  );
}
