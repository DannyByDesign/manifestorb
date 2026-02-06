"use client";

import { clearLastEmailAccountAction } from "@/actions/email-account-cookie";

export async function logOut(callbackUrl?: string) {
  clearLastEmailAccountAction();

  const returnTo = callbackUrl
    ? `/logout?return_to=${encodeURIComponent(callbackUrl)}`
    : "/logout";
  window.location.href = returnTo;
}
