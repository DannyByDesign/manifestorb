import { executeTool } from "@/server/features/ai/tools/executor";
import { queryTool } from "@/server/features/ai/tools/query";
import { modifyTool } from "@/server/features/ai/tools/modify";
import { createTool } from "@/server/features/ai/tools/create";
import type { ToolResult } from "@/server/features/ai/tools/types";
import type { CapabilityEnvironment } from "@/server/features/ai/capabilities/types";

export interface EmailCapabilities {
  searchThreads(filter: Record<string, unknown>): Promise<ToolResult>;
  batchArchive(ids: string[]): Promise<ToolResult>;
  unsubscribeSender(filterOrIds: { ids?: string[]; filter?: Record<string, unknown> }): Promise<ToolResult>;
  snoozeThread(ids: string[], snoozeUntil: string): Promise<ToolResult>;
  createDraft(input: {
    to: string[];
    subject?: string;
    body: string;
    threadId?: string;
    sendOnApproval?: boolean;
  }): Promise<ToolResult>;
  scheduleSend(_draftId: string, _sendAt: string): Promise<ToolResult>;
}

export function createEmailCapabilities(env: CapabilityEnvironment): EmailCapabilities {
  return {
    async searchThreads(filter) {
      return executeTool(queryTool, { resource: "email", filter }, env.toolContext);
    },

    async batchArchive(ids) {
      return executeTool(
        modifyTool,
        {
          resource: "email",
          ids,
          changes: { archive: true },
        },
        env.toolContext,
      );
    },

    async unsubscribeSender(filterOrIds) {
      return executeTool(
        modifyTool,
        {
          resource: "email",
          ...(filterOrIds.ids ? { ids: filterOrIds.ids } : {}),
          ...(filterOrIds.filter ? { filter: filterOrIds.filter } : {}),
          changes: { unsubscribe: true },
        },
        env.toolContext,
      );
    },

    async snoozeThread(ids, snoozeUntil) {
      return executeTool(
        modifyTool,
        {
          resource: "email",
          ids,
          changes: {
            snoozeUntil,
          },
        },
        env.toolContext,
      );
    },

    async createDraft(input) {
      return executeTool(
        createTool,
        {
          resource: "email",
          data: {
            to: input.to,
            subject: input.subject,
            body: input.body,
            threadId: input.threadId,
            sendOnApproval: input.sendOnApproval === true,
          },
        },
        env.toolContext,
      );
    },

    async scheduleSend(_draftId, _sendAt) {
      return {
        success: false,
        error: "Scheduled send via skill runtime is not implemented yet.",
        message: "I can draft your email now, but scheduled send is not available in this skill path yet.",
      };
    },
  };
}
