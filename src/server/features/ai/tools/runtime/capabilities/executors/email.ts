import type { RuntimeToolExecutorMap } from "@/server/features/ai/tools/runtime/capabilities/executors/types";
import {
  asBoolean,
  asObject,
  asString,
  asStringArray,
} from "@/server/features/ai/tools/runtime/capabilities/executors/utils";

export const emailToolExecutors: RuntimeToolExecutorMap = {
  "email.countUnread": async ({ args, capabilities }) =>
    capabilities.email.countUnread(asObject(args)),
  "email.search": async ({ args, capabilities }) =>
    capabilities.email.search(asObject(args)),
  "email.facetThreads": async ({ args, capabilities }) =>
    capabilities.email.facetThreads({
      filter: args.filter ? asObject(args.filter) : undefined,
      scanLimit: typeof args.scanLimit === "number" ? args.scanLimit : undefined,
      maxFacets: typeof args.maxFacets === "number" ? args.maxFacets : undefined,
    }),
  "email.getThreadMessages": async ({ args, capabilities }) =>
    capabilities.email.getThreadMessages(asString(args.threadId) ?? ""),
  "email.getMessagesBatch": async ({ args, capabilities }) =>
    capabilities.email.getMessagesBatch(asStringArray(args.ids)),
  "email.getLatestMessage": async ({ args, capabilities }) =>
    capabilities.email.getLatestMessage(asString(args.threadId) ?? ""),
  "email.batchArchive": async ({ args, capabilities }) =>
    capabilities.email.batchArchive({
      ids: asStringArray(args.ids),
      filter: args.filter ? asObject(args.filter) : undefined,
      limit: typeof args.limit === "number" ? args.limit : undefined,
    }),
  "email.batchTrash": async ({ args, capabilities }) =>
    capabilities.email.batchTrash({
      ids: asStringArray(args.ids),
      filter: args.filter ? asObject(args.filter) : undefined,
      limit: typeof args.limit === "number" ? args.limit : undefined,
    }),
  "email.markReadUnread": async ({ args, capabilities }) =>
    capabilities.email.markReadUnread({
      ids: asStringArray(args.ids),
      filter: args.filter ? asObject(args.filter) : undefined,
      limit: typeof args.limit === "number" ? args.limit : undefined,
      read: asBoolean(args.read) ?? true,
    }),
  "email.applyLabels": async ({ args, capabilities }) =>
    capabilities.email.applyLabels({
      ids: asStringArray(args.ids),
      filter: args.filter ? asObject(args.filter) : undefined,
      limit: typeof args.limit === "number" ? args.limit : undefined,
      labelIds: asStringArray(args.labelIds),
    }),
  "email.removeLabels": async ({ args, capabilities }) =>
    capabilities.email.removeLabels({
      ids: asStringArray(args.ids),
      filter: args.filter ? asObject(args.filter) : undefined,
      limit: typeof args.limit === "number" ? args.limit : undefined,
      labelIds: asStringArray(args.labelIds),
    }),
  "email.moveThread": async ({ args, capabilities }) =>
    capabilities.email.moveThread({
      ids: asStringArray(args.ids),
      filter: args.filter ? asObject(args.filter) : undefined,
      limit: typeof args.limit === "number" ? args.limit : undefined,
      folderName: asString(args.folderName) ?? "",
    }),
  "email.markSpam": async ({ args, capabilities }) =>
    capabilities.email.markSpam(asStringArray(args.ids)),
  "email.unsubscribeSender": async ({ args, capabilities }) =>
    capabilities.email.unsubscribeSender({
      ids: asStringArray(args.ids),
      filter: args.filter ? asObject(args.filter) : undefined,
    }),
  "email.blockSender": async ({ args, capabilities }) =>
    capabilities.email.blockSender(asStringArray(args.ids)),
  "email.bulkSenderArchive": async ({ args, capabilities }) =>
    capabilities.email.bulkSenderArchive(asObject(args.filter)),
  "email.bulkSenderTrash": async ({ args, capabilities }) =>
    capabilities.email.bulkSenderTrash(asObject(args.filter)),
  "email.bulkSenderLabel": async ({ args, capabilities }) =>
    capabilities.email.bulkSenderLabel({
      filter: asObject(args.filter),
      labelId: asString(args.labelId) ?? "",
    }),
  "email.snoozeThread": async ({ args, capabilities }) =>
    capabilities.email.snoozeThread(
      asStringArray(args.ids),
      asString(args.snoozeUntil) ?? "",
    ),
  "email.listFilters": async ({ capabilities }) => capabilities.email.listFilters(),
  "email.createFilter": async ({ args, capabilities }) =>
    capabilities.email.createFilter({
      from: asString(args.from) ?? "",
      addLabelIds: asStringArray(args.addLabelIds),
      removeLabelIds: asStringArray(args.removeLabelIds),
      autoArchiveLabelName: asString(args.autoArchiveLabelName),
    }),
  "email.deleteFilter": async ({ args, capabilities }) =>
    capabilities.email.deleteFilter(asString(args.id) ?? ""),
  "email.listDrafts": async ({ args, capabilities }) =>
    capabilities.email.listDrafts(
      typeof args.limit === "number" ? args.limit : undefined,
    ),
  "email.getDraft": async ({ args, capabilities }) =>
    capabilities.email.getDraft(asString(args.draftId) ?? ""),
  "email.createDraft": async ({ args, capabilities }) =>
    capabilities.email.createDraft({
      to: asStringArray(args.to),
      cc: asStringArray(args.cc),
      bcc: asStringArray(args.bcc),
      subject: asString(args.subject),
      body: asString(args.body) ?? "",
      type:
        args.type === "new" || args.type === "reply" || args.type === "forward"
          ? args.type
          : undefined,
      parentId: asString(args.parentId),
      sendOnApproval: asBoolean(args.sendOnApproval),
    }),
  "email.updateDraft": async ({ args, capabilities }) =>
    capabilities.email.updateDraft({
      draftId: asString(args.draftId) ?? "",
      subject: asString(args.subject),
      body: asString(args.body),
    }),
  "email.deleteDraft": async ({ args, capabilities }) =>
    capabilities.email.deleteDraft(asString(args.draftId) ?? ""),
  "email.sendDraft": async ({ args, capabilities }) =>
    capabilities.email.sendDraft(asString(args.draftId) ?? ""),
  "email.sendNow": async ({ args, capabilities }) =>
    capabilities.email.sendNow({
      draftId: asString(args.draftId),
      to: asStringArray(args.to),
      subject: asString(args.subject),
      body: asString(args.body),
    }),
  "email.reply": async ({ args, capabilities }) =>
    capabilities.email.reply({
      parentId: asString(args.parentId) ?? "",
      body: asString(args.body) ?? "",
      subject: asString(args.subject),
      mode: args.mode === "draft" || args.mode === "send" ? args.mode : undefined,
      replyAll: asBoolean(args.replyAll),
    }),
  "email.forward": async ({ args, capabilities }) =>
    capabilities.email.forward({
      parentId: asString(args.parentId) ?? "",
      to: asStringArray(args.to),
      body: asString(args.body),
      subject: asString(args.subject),
    }),
  "email.scheduleSend": async ({ args, capabilities }) =>
    capabilities.email.scheduleSend(
      asString(args.draftId) ?? "",
      asString(args.sendAt) ?? "",
    ),
};
