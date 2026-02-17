import type { EmailChanges } from "@/server/features/ai/tools/providers/types";
import type { EmailProvider } from "@/server/features/ai/tools/providers/email";

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
