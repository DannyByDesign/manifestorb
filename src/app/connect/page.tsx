import { redirect } from "next/navigation";
import prisma from "@/server/db/client";
import { auth } from "@/server/auth";
import { getGmailClientForEmail } from "@/server/lib/account";
import { createScopedLogger } from "@/server/lib/logger";
import { ConnectClient } from "./ConnectClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function ConnectPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const emailAccount = await prisma.emailAccount.findFirst({
    where: { userId: session.user.id },
    select: { id: true },
  });

  const emailAccountId = emailAccount?.id ?? null;
  const logger = createScopedLogger("connect");
  let gmailConnected = false;
  let gmailIssue: string | null = null;

  if (emailAccountId) {
    try {
      const gmail = await getGmailClientForEmail({ emailAccountId, logger });
      await gmail.users.getProfile({ userId: "me" });
      gmailConnected = true;
    } catch (error) {
      gmailIssue =
        error instanceof Error ? error.message : "Gmail connection failed";
    }
  }

  const [calendarConnection, driveConnection] = await Promise.all([
    emailAccountId
      ? prisma.calendarConnection.findFirst({
          where: { emailAccountId, isConnected: true },
          select: { id: true },
        })
      : null,
    emailAccountId
      ? prisma.driveConnection.findFirst({
          where: { emailAccountId, isConnected: true },
          select: { id: true },
        })
      : null,
  ]);

  return (
    <main className="min-h-screen bg-gray-50">
      <ConnectClient
        emailAccountId={emailAccountId}
        gmailConnected={gmailConnected}
        gmailIssue={gmailIssue}
        calendarConnected={Boolean(calendarConnection)}
        driveConnected={Boolean(driveConnection)}
      />
    </main>
  );
}
