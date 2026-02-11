
export type ApprovalRequestStatus = "PENDING" | "APPROVED" | "DENIED" | "EXPIRED" | "CANCELED";

export type CreateApprovalParams = {
    userId: string;
    provider: string; // "slack" | "discord" | "telegram" | "web"
    externalContext: unknown;
    requestPayload: {
        actionType: string;
        description?: string;
        args: Record<string, unknown>;
        tool?: string;
        options?: unknown;
        message?: string;
        [key: string]: unknown;
    };
    idempotencyKey: string;
    expiresInSeconds?: number;
    correlationId?: string;
    /** Cross-feature: what triggered this approval (e.g. "email_rule", "ai_tool") */
    sourceType?: string;
    sourceId?: string;
};

export type DecideApprovalParams = {
    approvalRequestId: string;
    decidedByUserId: string;
    decision: "APPROVE" | "DENY";
    reason?: string;
};

export type ApprovalServiceResponse<T> = {
    success: boolean;
    data?: T;
    error?: string;
};
