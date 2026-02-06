import { signOut } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

export const GET = async (request: NextRequest) => {
  await signOut();
  const returnTo = request.nextUrl.searchParams.get("return_to");
  return redirect(returnTo || "/");
};
