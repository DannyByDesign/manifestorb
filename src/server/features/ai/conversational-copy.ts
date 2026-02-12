const SUPPORTED_RESOURCE_LIST =
  "email, calendar, task, rules, preferences, contacts, draft, notification, or approval";

export function resourceClarificationPrompt(toolName: string): string {
  return `I can continue, but I need to know which resource this ${toolName} action is for (${SUPPORTED_RESOURCE_LIST}).`;
}

export function unsupportedResourceMessage(): string {
  return `I can do that, but I need to know which supported resource you want (${SUPPORTED_RESOURCE_LIST}).`;
}

export function unsupportedResourcePrompt(): string {
  return "Which resource is this for? For example: email or calendar.";
}

export function permissionDeniedMessage(): string {
  return "I can’t access that with your current permissions yet. Tell me the exact item you want, and I’ll try an allowed path.";
}

export function permissionDeniedPrompt(): string {
  return "Please tell me the exact item (email, event, or task) you want me to work on.";
}

export function rateLimitedMessage(): string {
  return "I’m temporarily rate-limited. Please try again in a few seconds.";
}

export function rateLimitedPrompt(): string {
  return "Please try again in a few seconds.";
}

export function genericRecoveryMessage(): string {
  return "I need one more detail before I can continue. Tell me what you want me to do and which item to act on.";
}

export function genericRecoveryPrompt(): string {
  return "Please clarify what you want and include the specific item.";
}

export function missingFieldsPrompt(joinedFields: string): string {
  return `I can continue, but I need a few details first: ${joinedFields}. Once you share that, I’ll proceed.`;
}

export function invalidFieldsPrompt(keys: string): string {
  return `Some details were in the wrong format (${keys}). Please restate your request with the key details you care about.`;
}

export function parseFailurePrompt(): string {
  return "I couldn’t parse that cleanly. Please restate what you want and the target item.";
}

export function createFailurePrompt(): string {
  return "I’m missing key details to create that. Tell me what to create and the required details, and I’ll proceed.";
}

export function modifyFailurePrompt(): string {
  return "I’m missing details on what to change. Tell me exactly what should be updated, and I’ll do it.";
}

export function deleteFailurePrompt(): string {
  return "I couldn’t identify what to delete. Tell me exactly which item(s) you want removed.";
}

export function missingTargetPrompt(): string {
  return "I couldn’t identify the target items for that action. Tell me exactly which item(s) you want me to act on.";
}

export function draftDetailsPrompt(): string {
  return "I can do that. Please share the draft details in one message: recipient, subject, and body.";
}

export function internalIssueMessage(): string {
  return "I ran into a temporary issue on my side. Please try again, and I’ll pick it up from there.";
}

export function fabricatedDraftBlockedMessage(): string {
  return "I haven’t created that draft yet. Say \"create the draft now\" and I’ll generate it and share the approval card.";
}
