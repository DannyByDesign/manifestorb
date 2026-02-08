import { auth } from "@/server/auth";
import { redirect } from "next/navigation";
import { LinkPageClient } from "./LinkPageClient";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }> | { [key: string]: string | string[] | undefined };

export default async function LinkPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  const params = typeof (searchParams as Promise<unknown>).then === "function"
    ? await (searchParams as Promise<{ [key: string]: string | string[] | undefined }>)
    : (searchParams as { [key: string]: string | string[] | undefined });
  const token = typeof params?.token === "string" ? params.token : null;

  if (!session?.user?.id) {
    const returnPath = token ? `/link?token=${encodeURIComponent(token)}` : "/link";
    redirect(`/login?returnTo=${encodeURIComponent(returnPath)}`);
  }

  return <LinkPageClient token={token} />;
}
