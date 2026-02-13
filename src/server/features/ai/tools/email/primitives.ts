import type { ParsedMessage } from "@/server/types";
import type { EmailChanges } from "@/server/features/ai/tools/providers/types";
import type { EmailProvider } from "@/server/features/ai/tools/providers/email";

export async function searchEmailThreads(
  provider: EmailProvider,
  filter: {
    query: string;
    limit?: number;
    fetchAll?: boolean;
    includeNonPrimary?: boolean;
    before?: Date;
    after?: Date;
    subjectContains?: string;
    bodyContains?: string;
    text?: string;
    from?: string;
    to?: string;
    hasAttachment?: boolean;
    sentByMe?: boolean;
    receivedByMe?: boolean;
  },
): Promise<{
  messages: ParsedMessage[];
  nextPageToken?: string;
  totalEstimate?: number;
}> {
  return provider.search(filter);
}

export async function getEmailThread(
  provider: EmailProvider,
  threadId: string,
) {
  return provider.getThread(threadId);
}

export async function getEmailMessages(
  provider: EmailProvider,
  ids: string[],
) {
  return provider.get(ids);
}

export async function modifyEmailMessages(
  provider: EmailProvider,
  ids: string[],
  changes: EmailChanges,
) {
  return provider.modify(ids, changes);
}

export async function trashEmailMessages(
  provider: EmailProvider,
  ids: string[],
) {
  return provider.trash(ids);
}
