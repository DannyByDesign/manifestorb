import { getSignInUrl } from "@/server/auth";
import { redirect } from "next/navigation";

export const GET = async () => {
  const signInUrl = await getSignInUrl();
  return redirect(signInUrl);
};
