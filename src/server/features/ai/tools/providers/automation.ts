
import { type Logger } from "@/server/lib/logger";
import prisma from "@/server/db/client";
import { type Rule, type Knowledge } from "@/generated/prisma/client";
import { ONBOARDING_PROCESS_EMAILS_COUNT } from "@/server/lib/config";
import { bulkProcessInboxEmails } from "@/features/rules/ai/bulk-process-emails";
import { createEmailProvider as createServiceEmailProvider } from "@/features/email/provider";
import { getEmailAccountWithAi } from "@/server/lib/user/get";
import { createRuleBody } from "@/actions/rule.validation";
import { createKnowledgeBody } from "@/actions/knowledge.validation";
import { getEmailReportData, type EmailReportData } from "@/actions/report";
import { unsubscribeFromSender } from "@/actions/execute";
import { findMatchingRules } from "@/features/rules/ai/match-rules";

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

    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { emailAccounts: true }
    });

    const emailAccountId = user?.emailAccounts?.[0]?.id;

    if (!emailAccountId) {
        throw new Error("No email account found for user");
    }

    return {
        // --- Rules ---

        async listRules() {
            return prisma.rule.findMany({
                where: { emailAccountId, enabled: true },
                include: { actions: true },
                orderBy: { createdAt: "desc" }
            });
        },

        async createRule(data: any) {
            // Validate using existing schema
            const validated = createRuleBody.parse(data);

            logger.info("Creating rule via Agent", { name: validated.name });

            // Flatten conditions for Prisma Code
            let from: string | undefined;
            let to: string | undefined;
            let subject: string | undefined;
            let body: string | undefined;
            let instructions: string | undefined;

            if (validated.conditions) {
                for (const c of validated.conditions) {
                    if (c.type === "STATIC") {
                        if (c.from) from = c.from;
                        if (c.to) to = c.to;
                        if (c.subject) subject = c.subject;
                        if (c.body) body = c.body;
                    } else if (c.type === "AI") {
                        if (c.instructions) instructions = c.instructions;
                    }
                }
            }
            if (validated.instructions) instructions = validated.instructions; // Top level override

            const rule = await prisma.rule.create({
                data: {
                    emailAccountId,
                    name: validated.name,
                    enabled: true,
                    instructions,
                    runOnThreads: validated.runOnThreads ?? true,
                    // Map flat fields
                    from,
                    to,
                    subject,
                    body,
                    actions: {
                        create: validated.actions.map((a) => ({
                            type: a.type,
                            to: a.to?.value,
                            cc: a.cc?.value,
                            bcc: a.bcc?.value,
                            subject: a.subject?.value,
                            content: a.content?.value,
                            folderName: a.folderName?.value,
                            labelId: a.labelId?.value,
                            delayInMinutes: a.delayInMinutes,
                            url: a.url?.value,
                        }))
                    }
                }
            });

            // Side Effect: Bulk Process (Background)
            // We can't await this or it slows down the Agent.
            const emailAccount = await getEmailAccountWithAi({ emailAccountId });
            if (emailAccount && emailAccount.account) {
                // Bulk process expects provider STRING
                bulkProcessInboxEmails({
                    emailAccount,
                    provider: emailAccount.account.provider,
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

            // Use 'economy' model for rule matching
            const modelType = "economy";

            const rules = await prisma.rule.findMany({
                where: { emailAccountId, enabled: true },
                include: { actions: true },
                orderBy: { createdAt: "desc" }
            });

            // Use Service Email Provider for matchRules (requires service features)
            const provider = await createServiceEmailProvider({
                emailAccountId: emailAccount.id,
                provider: emailAccount.account.provider,
                logger
            });

            const message = await provider.getMessage(messageId);

            return findMatchingRules({
                rules,
                message,
                emailAccount,
                provider,
                modelType,
                logger
            });
        }
    };
}
