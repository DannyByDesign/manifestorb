"use server";

import { actionClient } from "@/actions/safe-action";
import {
  disconnectMcpConnectionBody,
  toggleMcpConnectionBody,
  toggleMcpToolBody,
} from "@/actions/mcp.validation";
import prisma from "@/server/db/client";
import { SafeError } from "@/server/lib/error";
import { mcpAgent } from "@/features/mcp/ai/mcp-agent";
import { getEmailAccountWithAi } from "@/server/lib/user/get";
import type { EmailForLLM } from "@/server/types";
import { testMcpSchema } from "@/actions/mcp.validation";

export const disconnectMcpConnectionAction = actionClient
  .metadata({ name: "disconnectMcpConnection" })
  .inputSchema(disconnectMcpConnectionBody)
  .action(
    async ({ ctx: { emailAccountId }, parsedInput: { connectionId } }) => {
      await prisma.mcpConnection.delete({
        where: { id: connectionId, emailAccountId },
      });
    },
  );

export const toggleMcpConnectionAction = actionClient
  .metadata({ name: "toggleMcpConnection" })
  .inputSchema(toggleMcpConnectionBody)
  .action(
    async ({
      ctx: { emailAccountId },
      parsedInput: { connectionId, isActive },
    }) => {
      await prisma.mcpConnection.update({
        where: { id: connectionId, emailAccountId },
        data: { isActive },
      });
    },
  );

export const toggleMcpToolAction = actionClient
  .metadata({ name: "toggleMcpTool" })
  .inputSchema(toggleMcpToolBody)
  .action(
    async ({ ctx: { emailAccountId }, parsedInput: { toolId, isEnabled } }) => {
      await prisma.mcpTool.update({
        where: { id: toolId, connection: { emailAccountId } },
        data: { isEnabled },
      });
    },
  );

export const testMcpAction = actionClient
  .metadata({ name: "mcpAgent" })
  .inputSchema(testMcpSchema)
  .action(
    async ({
      ctx: { emailAccountId },
      parsedInput: { from, subject, content },
    }) => {
      const emailAccount = await getEmailAccountWithAi({ emailAccountId });
      if (!emailAccount) throw new SafeError("Email account not found");

      const testMessage: EmailForLLM = {
        id: "test-message-id",
        to: emailAccount.email,
        from,
        subject,
        content,
      };

      const result = await mcpAgent({ emailAccount, messages: [testMessage] });

      return {
        response: result?.response,
        toolCalls: result?.getToolCalls(),
      };
    },
  );
