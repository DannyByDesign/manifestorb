import { config } from "dotenv";
import { env } from "./env";
config();

const BRAIN_API_URL = env.BRAIN_API_URL;
const SHARED_SECRET = env.SURFACES_SHARED_SECRET ?? "dev-secret";
console.log(`[Surfaces] Using Secret: ${SHARED_SECRET.substring(0, 3)}...`);

export interface InteractiveAction {
    label: string;
    style: "primary" | "danger";
    value: string;
    url?: string;
}

export interface DraftPreview {
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    body: string;
}

export interface ActionRequestContext {
    resource: "calendar" | "task";
    action: "create" | "modify" | "delete" | "reschedule";
    title?: string;
    timeRange?: string;
}

export interface InteractivePayload {
    type: "approval_request" | "draft_created" | "action_request" | "ambiguous_time";
    approvalId?: string;  // For approval_request
    draftId?: string;     // For draft_created
    emailAccountId?: string; // For draft_created - needed to identify account
    userId?: string;      // For draft_created - needed for auth
    ambiguousRequestId?: string; // For ambiguous_time
    summary: string;
    actions: InteractiveAction[];
    preview?: DraftPreview; // For draft_created - full draft content for review
    context?: ActionRequestContext; // For action_request - calendar/task context
}

export async function forwardToBrain(params: {
    provider: "slack" | "discord" | "telegram";
    content: string;
    context: any;
    history?: { role: "user" | "assistant"; content: string }[];
}) {
    try {
        console.log(`[Surfaces] Forwarding to Brain (${params.provider}): ${params.content.substring(0, 50)}...`);
        const response = await fetch(BRAIN_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${SHARED_SECRET}`,
            },
            body: JSON.stringify(params),
        });

        if (!response.ok) {
            console.error(`[Surfaces] Brain Error: ${response.status} ${response.statusText}`);
            const text = await response.text();
            console.error(text);
            return null;
        }

        return await response.json();
    } catch (error) {
        console.error("[Surfaces] Network Error forwarding to Brain:", error);
        return null;
    }
}
