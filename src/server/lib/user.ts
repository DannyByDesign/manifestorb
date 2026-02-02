"use client";

import { signOut } from "@/server/lib/auth-client";
import { clearLastEmailAccountAction } from "@/actions/email-account-cookie";

export async function logOut(callbackUrl?: string) {
  clearLastEmailAccountAction();

  await signOut({
    fetchOptions: {
      onSuccess: () => {
        window.location.href = callbackUrl || "/";
      },
      onError: () => {
        window.location.href = callbackUrl || "/";
      },
    },
  });
}
