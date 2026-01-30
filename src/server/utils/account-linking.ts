
import { isGoogleProvider } from "@/server/services/email/provider-types";

/**
 * Initiates the OAuth account linking flow for Google or Microsoft.
 * Returns the OAuth URL to redirect the user to.
 * @throws Error if the request fails
 */
export async function getAccountLinkingUrl(
  provider: "google" | "microsoft",
): Promise<string> {
  const apiProvider = provider === "microsoft" ? "outlook" : "google";

  const response = await fetch(`/api/${apiProvider}/linking/auth-url`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to initiate ${isGoogleProvider(provider) ? "Google" : "Microsoft"} account linking`,
    );
  }

  const data: { url: string } =
    await response.json();

  return data.url;
}
