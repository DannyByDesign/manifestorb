import type { RuntimeToolExecutorMap } from "@/server/features/ai/tools/runtime/capabilities/executors/types";
import { asBoolean, asObject, asString } from "@/server/features/ai/tools/runtime/capabilities/executors/utils";

export const policyToolExecutors: RuntimeToolExecutorMap = {
  "policy.listRules": async ({ args, capabilities }) =>
    capabilities.policy.listRules({
      ...(args.type === "guardrail" ||
      args.type === "automation" ||
      args.type === "preference"
        ? { type: args.type }
        : {}),
    }),
  "policy.compileRule": async ({ args, capabilities }) =>
    capabilities.policy.compileRule({
      input: asString(args.input) ?? "",
    }),
  "policy.createRule": async ({ args, capabilities }) =>
    capabilities.policy.createRule({
      input: asString(args.input) ?? "",
      activate: asBoolean(args.activate),
    }),
  "policy.updateRule": async ({ args, capabilities }) =>
    capabilities.policy.updateRule({
      id: asString(args.id) ?? undefined,
      target: asString(args.target) ?? undefined,
      type:
        args.type === "guardrail" || args.type === "automation" || args.type === "preference"
          ? args.type
          : undefined,
      patch: args.patch ? asObject(args.patch) : {},
    }),
  "policy.disableRule": async ({ args, capabilities }) =>
    capabilities.policy.disableRule({
      id: asString(args.id) ?? undefined,
      target: asString(args.target) ?? undefined,
      type:
        args.type === "guardrail" || args.type === "automation" || args.type === "preference"
          ? args.type
          : undefined,
      disabledUntil: asString(args.disabledUntil),
    }),
  "policy.deleteRule": async ({ args, capabilities }) =>
    capabilities.policy.deleteRule({
      id: asString(args.id) ?? undefined,
      target: asString(args.target) ?? undefined,
      type:
        args.type === "guardrail" || args.type === "automation" || args.type === "preference"
          ? args.type
          : undefined,
    }),
};
