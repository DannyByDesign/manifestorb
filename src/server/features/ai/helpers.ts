import type { EmailAccountWithAI } from "@/server/lib/llms/types";
import { stringifyEmail } from "@/server/lib/stringify-email";
import type { EmailForLLM } from "@/server/types";

export function getTodayForLLM(date: Date = new Date(), timeZone?: string) {
  if (timeZone) {
    const formatted = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
      timeZone,
    }).format(date);
    return `Today's date and time is: ${formatted} (${timeZone}).`;
  }
  return `Today's date and time is: ${date.toISOString()}.`;
}

export const getUserInfoPrompt = ({
  emailAccount,
  prefix = "The user you are acting on behalf of is:",
}: {
  emailAccount: EmailAccountWithAI & { name?: string | null };
  prefix?: string;
}) => {
  const info = [
    {
      label: "email",
      value: emailAccount.email,
    },
    {
      label: "name",
      value: emailAccount.name,
    },
    {
      label: "about",
      value: emailAccount.about,
    },
  ].filter((i) => i.value);

  return `${prefix || ""}
<user_info>
${info.map((i) => `<${i.label}>${i.value}</${i.label}>`).join("\n")}
</user_info>`.trim();
};

export const getUserRulesPrompt = ({
  rules,
}: {
  rules: { name: string; instructions: string }[];
}) => {
  return `<user_rules>
${rules
  .map(
    (rule) => `<rule>
  <name>${rule.name}</name>
  <criteria>${rule.instructions}</criteria>
</rule>`,
  )
  .join("\n")}
</user_rules>`;
};

export const getEmailListPrompt = ({
  messages,
  messageMaxLength,
  maxMessages,
}: {
  messages: EmailForLLM[];
  messageMaxLength: number;
  maxMessages?: number;
}) => {
  const messagesToUse = maxMessages ? messages.slice(-maxMessages) : messages;

  return messagesToUse
    .map((email) => `<email>${stringifyEmail(email, messageMaxLength)}</email>`)
    .join("\n");
};
