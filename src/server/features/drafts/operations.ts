import type { ParsedMessage } from "@/server/types";

export type DraftCreateParams = {
  type: "new" | "reply" | "forward";
  parentId?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body?: string;
};

export type DraftUpdateParams = {
  messageHtml?: string;
  subject?: string;
};

export type DraftOperationProvider = {
  createDraft(params: DraftCreateParams): Promise<{ draftId: string; preview: unknown }>;
  getDrafts(options?: { maxResults?: number }): Promise<ParsedMessage[]>;
  getDraft(draftId: string): Promise<ParsedMessage | null>;
  updateDraft(draftId: string, params: DraftUpdateParams): Promise<void>;
  deleteDraft(draftId: string): Promise<void>;
  sendDraft(draftId: string): Promise<{ messageId: string; threadId: string }>;
};

export type FormattedDraft = {
  id: string;
  threadId: string;
  subject: string;
  to: string;
  from: string;
  date: string;
  snippet: string;
  body: string;
};

export async function createDraft(
  provider: DraftOperationProvider,
  params: DraftCreateParams,
): Promise<{ draftId: string; preview: unknown }> {
  return provider.createDraft(params);
}

export async function listDrafts(
  provider: Pick<DraftOperationProvider, "getDrafts">,
  options?: { maxResults?: number },
): Promise<ParsedMessage[]> {
  return provider.getDrafts(options);
}

export async function getDraftById(
  provider: Pick<DraftOperationProvider, "getDraft">,
  draftId: string,
): Promise<ParsedMessage | null> {
  return provider.getDraft(draftId);
}

export async function updateDraftById(
  provider: Pick<DraftOperationProvider, "updateDraft">,
  draftId: string,
  params: DraftUpdateParams,
): Promise<void> {
  await provider.updateDraft(draftId, params);
}

export async function deleteDraftById(
  provider: Pick<DraftOperationProvider, "deleteDraft">,
  draftId: string,
): Promise<void> {
  await provider.deleteDraft(draftId);
}

export async function sendDraftById({
  provider,
  draftId,
  requireExisting,
}: {
  provider: Pick<DraftOperationProvider, "getDraft" | "sendDraft">;
  draftId: string;
  requireExisting?: boolean;
}): Promise<{ messageId: string; threadId: string }> {
  if (requireExisting) {
    const draft = await provider.getDraft(draftId);
    if (!draft) {
      throw new Error("Draft not found");
    }
  }

  return provider.sendDraft(draftId);
}

export function formatDraftForApi({
  draft,
  fallbackFrom,
}: {
  draft: ParsedMessage;
  fallbackFrom: string;
}): FormattedDraft {
  return {
    id: draft.id,
    threadId: draft.threadId,
    subject: draft.headers?.subject || "(no subject)",
    to: draft.headers?.to || "",
    from: draft.headers?.from || fallbackFrom,
    date: draft.headers?.date || new Date().toISOString(),
    snippet: draft.snippet || draft.textPlain?.slice(0, 200) || "",
    body: draft.textHtml || draft.textPlain || "",
  };
}
