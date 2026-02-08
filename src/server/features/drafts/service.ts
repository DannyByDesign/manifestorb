import { createEmailProvider } from "@/features/email/provider";
import type { Logger } from "@/server/lib/logger";
import { findUserEmailAccountWithProvider } from "@/server/lib/user/email-account";
import {
  deleteDraftById,
  formatDraftForApi,
  getDraftById,
  listDrafts,
  sendDraftById,
  type FormattedDraft,
} from "@/features/drafts/operations";

export type DraftContext = {
  emailAccountId: string;
  email: string;
  providerName: string;
  provider: Awaited<ReturnType<typeof createEmailProvider>>;
};

export async function resolveDraftContextForUser({
  userId,
  logger,
  emailAccountId,
}: {
  userId: string;
  logger: Logger;
  emailAccountId?: string;
}): Promise<DraftContext | null> {
  const emailAccount = await findUserEmailAccountWithProvider({
    userId,
    emailAccountId,
  });

  if (!emailAccount) {
    return null;
  }

  const provider = await createEmailProvider({
    emailAccountId: emailAccount.id,
    provider: emailAccount.account.provider,
    logger,
  });

  return {
    emailAccountId: emailAccount.id,
    email: emailAccount.email,
    providerName: emailAccount.account.provider,
    provider,
  };
}

export async function listUserDrafts({
  userId,
  logger,
  emailAccountId,
  maxResults,
}: {
  userId: string;
  logger: Logger;
  emailAccountId?: string;
  maxResults?: number;
}): Promise<
  | { success: false; error: "EMAIL_ACCOUNT_NOT_FOUND" }
  | {
      success: true;
      drafts: FormattedDraft[];
      emailAccountId: string;
      count: number;
    }
> {
  const context = await resolveDraftContextForUser({
    userId,
    logger,
    emailAccountId,
  });
  if (!context) {
    return { success: false, error: "EMAIL_ACCOUNT_NOT_FOUND" };
  }

  const drafts = await listDrafts(context.provider, { maxResults });
  const formattedDrafts = drafts.map((draft) =>
    formatDraftForApi({ draft, fallbackFrom: context.email }),
  );

  return {
    success: true,
    drafts: formattedDrafts,
    emailAccountId: context.emailAccountId,
    count: formattedDrafts.length,
  };
}

export async function getUserDraftById({
  userId,
  draftId,
  logger,
  emailAccountId,
}: {
  userId: string;
  draftId: string;
  logger: Logger;
  emailAccountId?: string;
}): Promise<
  | { success: false; error: "EMAIL_ACCOUNT_NOT_FOUND" | "DRAFT_NOT_FOUND" }
  | { success: true; draft: Awaited<ReturnType<typeof getDraftById>> }
> {
  const context = await resolveDraftContextForUser({
    userId,
    logger,
    emailAccountId,
  });
  if (!context) {
    return { success: false, error: "EMAIL_ACCOUNT_NOT_FOUND" };
  }

  const draft = await getDraftById(context.provider, draftId);
  if (!draft) {
    return { success: false, error: "DRAFT_NOT_FOUND" };
  }

  return { success: true, draft };
}

export async function deleteUserDraftById({
  userId,
  draftId,
  logger,
  emailAccountId,
}: {
  userId: string;
  draftId: string;
  logger: Logger;
  emailAccountId?: string;
}): Promise<
  | { success: false; error: "EMAIL_ACCOUNT_NOT_FOUND" }
  | { success: true; emailAccountId: string }
> {
  const context = await resolveDraftContextForUser({
    userId,
    logger,
    emailAccountId,
  });
  if (!context) {
    return { success: false, error: "EMAIL_ACCOUNT_NOT_FOUND" };
  }

  await deleteDraftById(context.provider, draftId);
  return { success: true, emailAccountId: context.emailAccountId };
}

export async function sendUserDraftById({
  userId,
  draftId,
  logger,
  emailAccountId,
}: {
  userId: string;
  draftId: string;
  logger: Logger;
  emailAccountId?: string;
}): Promise<
  | { success: false; error: "EMAIL_ACCOUNT_NOT_FOUND" }
  | {
      success: true;
      emailAccountId: string;
      messageId: string;
      threadId: string;
    }
> {
  const context = await resolveDraftContextForUser({
    userId,
    logger,
    emailAccountId,
  });
  if (!context) {
    return { success: false, error: "EMAIL_ACCOUNT_NOT_FOUND" };
  }

  const result = await sendDraftById({
    provider: context.provider,
    draftId,
    requireExisting: true,
  });

  return {
    success: true,
    emailAccountId: context.emailAccountId,
    messageId: result.messageId,
    threadId: result.threadId,
  };
}
