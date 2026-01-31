
export type ApprovalRequestStatus = "PENDING" | "APPROVED" | "DENIED" | "EXPIRED" | "CANCELED";

export type CreateApprovalParams = {
    userId: string;
    provider: string; // "slack" | "discord" | "telegram" | "web"
    externalContext: Record<string, any>;
    requestPayload: {
        actionType: string;
        description: string;
        args: Record<string, any>;
    };
    idempotencyKey: string;
    expiresInSeconds?: number;
    correlationId?: string;
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
