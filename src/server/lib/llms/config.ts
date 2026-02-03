export const DEFAULT_PROVIDER = "DEFAULT";

export const Provider = {
  ANTHROPIC: "anthropic",
  OPEN_AI: "openai",
  GOOGLE: "google",
};

export const providerOptions: { label: string; value: string }[] = [
  { label: "Default", value: DEFAULT_PROVIDER },
  { label: "Anthropic", value: Provider.ANTHROPIC },
  { label: "OpenAI", value: Provider.OPEN_AI },
  { label: "Google", value: Provider.GOOGLE },
];
