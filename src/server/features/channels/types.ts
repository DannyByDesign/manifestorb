
export type ChannelProvider = "slack" | "discord" | "telegram" | "web";

export type InboundMessageContext = {
    workspaceId?: string;
    channelId: string;
    channelName?: string;
    threadId?: string; // If this message is part of a thread
    userId: string;
    userName?: string;
    messageId: string; // The specific message ID (ts in Slack)
    isDirectMessage: boolean;
};

export type InboundMessage = {
    provider: ChannelProvider;
    content: string;
    context: InboundMessageContext;
    attachments?: InboundAttachment[];
    history?: { role: "user" | "assistant"; content: string }[];
};

export type InboundAttachment = {
    type: "image" | "file";
    url: string;
    name?: string;
    mimeType?: string;
};

export type OutboundMessage = {
    targetChannelId: string;
    targetThreadId?: string; // Reply in thread if present
    content: string; // Markdown supported
    // simplified block kit / embed structure could go here later
    interactive?: InteractivePayload;
};

export type DraftPreview = {
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    body: string;
};

export type ActionRequestContext = {
    resource: "calendar" | "task";
    action: "create" | "modify" | "delete" | "reschedule";
    title?: string;
    timeRange?: string;
};

export type InteractivePayload = {
    type: "approval_request" | "draft_created" | "action_request" | "ambiguous_time";
    approvalId?: string;   // For approval_request
    draftId?: string;      // For draft_created
    emailAccountId?: string; // For draft_created
    userId?: string;       // For draft_created
    ambiguousRequestId?: string; // For ambiguous_time
    summary: string;
    actions: {
        label: string;
        style: "primary" | "danger";
        value: string; // e.g. "approve" via webhook, or "send" for drafts
        url?: string; // if a direct link (e.g., Edit in Gmail)
    }[];
    preview?: DraftPreview; // For draft_created - full draft content for review
    context?: ActionRequestContext; // For action_request - calendar/task context
};
