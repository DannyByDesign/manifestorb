"use client";

export async function logOut(callbackUrl?: string) {
  const returnTo = callbackUrl
    ? `/logout?return_to=${encodeURIComponent(callbackUrl)}`
    : "/logout";
  window.location.href = returnTo;
}
