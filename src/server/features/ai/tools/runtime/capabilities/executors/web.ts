import type { RuntimeToolExecutorMap } from "@/server/features/ai/tools/runtime/capabilities/executors/types";
import { asString } from "@/server/features/ai/tools/runtime/capabilities/executors/utils";

export const webToolExecutors: RuntimeToolExecutorMap = {
  "web.search": async ({ args, capabilities }) =>
    capabilities.web.search({
      query: asString(args.query) ?? "",
      count: typeof args.count === "number" ? args.count : undefined,
      country: asString(args.country),
      search_lang: asString(args.search_lang),
      ui_lang: asString(args.ui_lang),
      freshness: asString(args.freshness),
    }),
  "web.fetch": async ({ args, capabilities }) =>
    capabilities.web.fetch({
      url: asString(args.url) ?? "",
      extractMode: asString(args.extractMode) === "text" ? "text" : "markdown",
      maxChars: typeof args.maxChars === "number" ? args.maxChars : undefined,
    }),
};
