
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

export type InteractivePayload = {
    type: "approval_request";
    approvalId: string;
    summary: string;
    actions: {
        label: string;
        style: "primary" | "danger";
        value: string; // e.g. "approve" via webhook
        url?: string; // if a direct link
    }[];
};
