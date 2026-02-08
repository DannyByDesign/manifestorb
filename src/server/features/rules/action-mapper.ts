import { isMicrosoftProvider } from "@/features/email/provider-types";
import type { ActionType } from "@/generated/prisma/enums";

export type RuleActionFieldsInput = {
  label?: string | null;
  content?: string | null;
  webhookUrl?: string | null;
  to?: string | null;
  cc?: string | null;
  bcc?: string | null;
  subject?: string | null;
  payload?: unknown;
  folderName?: string | null;
};

export type RuleActionInput = {
  type: ActionType;
  fields?: RuleActionFieldsInput | null;
  delayInMinutes?: number | null;
};

function mapRuleActionFieldsForProvider({
  fields,
  provider,
}: {
  fields?: RuleActionFieldsInput | null;
  provider: string;
}): RuleActionFieldsInput | null {
  if (!fields) return null;

  return {
    content: fields.content ?? null,
    to: fields.to ?? null,
    subject: fields.subject ?? null,
    label: fields.label ?? null,
    webhookUrl: fields.webhookUrl ?? null,
    cc: fields.cc ?? null,
    bcc: fields.bcc ?? null,
    payload: fields.payload ?? null,
    ...(isMicrosoftProvider(provider)
      ? { folderName: fields.folderName ?? null }
      : {}),
  };
}

export function mapRuleActionsForMutation({
  actions,
  provider,
}: {
  actions: RuleActionInput[];
  provider: string;
}): RuleActionInput[] {
  return actions.map((action) => ({
    type: action.type,
    fields: mapRuleActionFieldsForProvider({
      fields: action.fields,
      provider,
    }),
    ...(action.delayInMinutes !== undefined
      ? { delayInMinutes: action.delayInMinutes ?? null }
      : {}),
  }));
}
