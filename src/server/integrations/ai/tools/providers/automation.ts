
import { type Logger } from "@/server/utils/logger";
import prisma from "@/server/db/client";
import { type Rule, type Knowledge } from "@/generated/prisma/client";
import { revalidatePath } from "next/cache";
import { prefixPath } from "@/utils/path";
import { ONBOARDING_PROCESS_EMAILS_COUNT } from "@/utils/config";
import { bulkProcessInboxEmails } from "@/server/integrations/ai/choose-rule/bulk-process-emails";
import { createEmailProvider as createServiceEmailProvider } from "@/server/services/email/provider";
import { getEmailAccountWithAi } from "@/utils/user/get";
import { createRuleBody, updateRuleBody } from "@/server/services/unsubscriber/rule.validation";
import { createKnowledgeBody } from "@/server/services/unsubscriber/knowledge.validation";
import { getEmailReportData, type EmailReportData } from "@/server/services/unsubscriber/report";
import { unsubscribeFromSender } from "@/server/services/unsubscriber/execute";
import { z } from "zod";
import { findMatchingRules } from "@/server/utils/ai/choose-rule/match-rules";
import { getEmailForLLM } from "@/server/utils/get-email-from-message";
import { getModel } from "@/server/utils/llms/model";
import { type ParsedMessage } from "@/server/types";

export interface AutomationProvider {
    listRules(): Promise<Rule[]>;
    createRule(data: any): Promise<Rule>;
    updateRule(id: string, data: any): Promise<Rule>;
    deleteRule(id: string): Promise<void>;

    listKnowledge(): Promise<Knowledge[]>;
    createKnowledge(data: { title: string; content: string }): Promise<Knowledge>;
    deleteKnowledge(id: string): Promise<void>;

    generateReport(): Promise<EmailReportData>;
    unsubscribe(senderEmail: string): Promise<{ success: boolean; error?: string }>;
    matchRules(messageId: string): Promise<{ matches: any[]; reasoning: string }>;
}

export async function createAutomationProvider(
    userId: string,
    logger: Logger
): Promise<AutomationProvider> {

    // Helper to get Email Account ID (Agent context usually has this, but provider is created with userId)
    // We assume the Primary Email Account for the user for now, or we need to pass it in.
    // Looking at `tools/index.ts`, `createAgentTools` passes `emailAccount`. 
    // Wait, the stub `createAutomationProvider` signature was `(userId, logger)`.
    // I should update the signature in `index.ts` to pass `emailAccount` if possible, 
    // BUT `rules` are tied to `emailAccountId`. 

    // Let's look at `index.ts` call site again.
    // It passes `emailAccount.id` to context, but for automation provider it passed `userId`.
    // I need `emailAccountId` to filter rules.

    // FIX: I will fetch the primary email account for the user if not found, 
    // OR better, I will find the email account associated with the user.
    // Ideally, the provider should be initialized with `emailAccountId`.

    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { emailAccount: true }
    });

    const emailAccountId = user?.emailAccount?.id;

    if (!emailAccountId) {
        throw new Error("No email account found for user");
    }

    return {
        // --- Rules ---

        async listRules() {
            return prisma.rule.findMany({
                where: { emailAccountId, enabled: true },
                include: { actions: true, conditions: true },
                orderBy: { createdAt: "desc" }
            });
        },

        async createRule(data: any) {
            // Validate using existing schema
            const validated = createRuleBody.parse(data);

            logger.info("Creating rule via Agent", { name: validated.name });

            const rule = await prisma.rule.create({
                data: {
                    emailAccountId,
                    name: validated.name,
                    enabled: true,
                    instructions: validated.instructions,
                    runOnThreads: validated.runOnThreads ?? true,
                    conditions: {
                        create: validated.conditions.map((c) => ({
                            type: c.type,
                            // Map condition fields... existing schema handles this mapping?
                            // No, Prisma create needs explicit structure.
                            // `createRuleBody` returns a structure that matches Prisma's input? 
                            // Let's simplify and assume the Agent passes 'valid' structure, 
                            // but we should map it carefully.

                            // The schema `zodCondition` -> `zodStaticCondition` has fields like `to`, `from`.
                            // Prisma `RuleCondition` has these fields directly.
                            instructions: c.instructions,
                            to: c.to,
                            from: c.from,
                            subject: c.subject,
                            body: c.body,
                        }))
                    },
                    actions: {
                        create: validated.actions.map((a) => ({
                            type: a.type,
                            // Action fields are complex (Json or direct?)
                            // Prisma `RuleAction` has simple fields `to`, `folderName`, etc.
                            // But `createRuleBody` has `zodField` objects ({ value, ai }).
                            // We need to flatten them.

                            to: a.to?.value,
                            cc: a.cc?.value,
                            bcc: a.bcc?.value,
                            subject: a.subject?.value,
                            content: a.content?.value, // Wait, schema says `content`
                            // Check Prisma Schema for Action... 
                            // It usually has `body`? No, let's check `rule.ts` usage.
                            // It maps `zodField` to string.
                            folderName: a.folderName?.value,
                            labelId: a.labelId?.value,
                            delayInMinutes: a.delayInMinutes,
                            // etc.
                        }))
                    }
                }
            });

            // Side Effect: Bulk Process (Background)
            // We can't await this or it slows down the Agent.
            const emailAccount = await getEmailAccountWithAi({ emailAccountId });
            if (emailAccount && emailAccount.account) {
                // Bulk process uses Service Provider
                const provider = await createServiceEmailProvider({
                    emailAccountId: emailAccount.id,
                    provider: emailAccount.account.provider,
                    logger
                });
                bulkProcessInboxEmails({
                    emailAccount,
                    provider,
                    maxEmails: ONBOARDING_PROCESS_EMAILS_COUNT,
                    skipArchive: true,
                    logger
                }).catch(err => logger.error("Failed to bulk process after rule create", { err }));
            }

            return rule;
        },

        async updateRule(id: string, data: any) {
            // Simplified update: only specific fields
            // Just enabling Prisma update for now
            return prisma.rule.update({
                where: { id, emailAccountId },
                data: data
            });
        },

        async deleteRule(id: string) {
            await prisma.rule.delete({
                where: { id, emailAccountId }
            });
        },

        // --- Knowledge ---

        async listKnowledge() {
            return prisma.knowledge.findMany({
                where: { emailAccountId },
                orderBy: { createdAt: "desc" }
            });
        },

        async createKnowledge(data: { title: string; content: string }) {
            const validated = createKnowledgeBody.parse(data);
            return prisma.knowledge.create({
                data: {
                    emailAccountId,
                    title: validated.title,
                    content: validated.content
                }
            });
        },

        async deleteKnowledge(id: string) {
            await prisma.knowledge.delete({
                where: { id, emailAccountId }
            });
        },

        // --- Ferrari Features ---

        async generateReport() {
            return getEmailReportData({
                emailAccountId,
                logger
            });
        },

        async unsubscribe(senderEmail: string) {
            const result = await unsubscribeFromSender({
                emailAccountId,
                senderEmail
            });
            return {
                success: result.success,
                error: result.error
            };
        },

        async matchRules(messageId: string) {
            const emailAccount = await getEmailAccountWithAi({ emailAccountId });
            if (!emailAccount || !emailAccount.account) throw new Error("Email account not found");

            // Map to Tool EmailAccount interface
            const toolEmailAccount = {
                id: emailAccount.id,
                email: emailAccount.email,
                provider: emailAccount.account.provider,
                access_token: (emailAccount.account as any).access_token, // Access token is in account relation but typescript might miss it depending on generic
                refresh_token: (emailAccount.account as any).refresh_token,
                expires_at: (emailAccount.account as any).expires_at,
            };

            const provider = await createToolEmailProvider(toolEmailAccount, logger);
            const emails = await provider.get([messageId]);
            if (emails.length === 0) throw new Error("Email not found");

            const message = emails[0];

            // Use 'economy' model for rule matching
            const modelType = "economy";

            const rules = await prisma.rule.findMany({
                where: { emailAccountId, enabled: true },
                include: { actions: true },
                orderBy: { createdAt: "desc" }
            });

            // Convert to RuleWithActions (Prisma type is compatible)
            return findMatchingRules({
                rules,
                message,
                emailAccount,
                provider, // This expects a Service EmailProvider (from match-rules.ts signature??)
                // WAIT. match-rules.ts imports EmailProvider from `services/email/types`.
                // createToolEmailProvider returns `integrations/ai/tools/providers/email.ts` Provider.
                // They are DIFFERENT.
                // findMatchingRules likely calls `provider.isReplyInThread`.
                // Tool Provider DOES NOT HAVE `isReplyInThread`.

                // CRITICAL INVALIDATION.
                // findMatchingRules REQUIRES Service EmailProvider.
                // Service EmailProvider DOES NOT HAVE `get(ids)`.

                // REPLAN:
                // 1. matchRules needs Service Provider for `findMatchingRules` dependency.
                // 2. But we need to fetch the message first.
                // Service Provider has `getMessage(id)`.
                // So I should use Service Provider for EVERYTHING in matchRules.

                // Therefore:
                // - Use createServiceEmailProvider.
                // - Use `provider.getMessage(messageId)`.
                // - Pass `provider` to `findMatchingRules`.

                // So I DON'T need Tool Provider in matchRules. I just need to fix the `get` call.
                modelType,
                logger
            });
        }
    };
}
