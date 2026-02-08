import { getSignInUrl } from "@/server/auth";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";

/** Allow only same-origin path (no protocol or host) to prevent open redirect. */
function safeReturnPath(returnTo: string | null): string | null {
  if (!returnTo || typeof returnTo !== "string") return null;
  const trimmed = returnTo.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("://")) {
    return null;
  }
  return trimmed;
}

export const GET = async (request: NextRequest) => {
  const returnTo = safeReturnPath(request.nextUrl.searchParams.get("returnTo") ?? null);
  const state = returnTo
    ? Buffer.from(JSON.stringify({ returnPathname: returnTo })).toString("base64")
    : undefined;
  const signInUrl = await getSignInUrl(state ? { state } : {});
  return redirect(signInUrl);
};
