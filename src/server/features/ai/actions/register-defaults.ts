/**
 * Register built-in actions with the registry (for prompt-to-rules and future extensibility).
 */
import { registerAction } from "./registry";
import { schedule_meeting, notify_user } from "../actions";

registerAction({
  type: "SCHEDULE_MEETING",
  name: "Schedule Meeting",
  description:
    "Finds available calendar slots, creates a draft reply, and sends an approval notification",
  inputFields: [],
  execute: (opts) => schedule_meeting(opts),
  availableForRules: true,
  triggerPatterns: [
    "when someone asks to meet",
    "when someone wants to schedule",
    "when a meeting request comes in",
    "find times and draft a reply",
  ],
});

registerAction({
  type: "NOTIFY_USER",
  name: "Notify User",
  description: "Send a push notification to the user about the matching email",
  inputFields: [],
  execute: (opts) => notify_user(opts),
  availableForRules: true,
  triggerPatterns: ["notify me when", "alert me about", "let me know when"],
});
