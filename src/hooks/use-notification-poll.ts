
"use client";

import { useEffect, useState, useCallback } from "react";
import useSWR, { mutate } from "swr";
import { toast } from "sonner";
import { type InAppNotification } from "@/generated/prisma/client";

// Simplified type if client doesn't have prisma types loaded
type Notification = {
    id: string;
    title: string;
    body?: string;
    type: string;
    metadata?: any;
    createdAt: string;
};

const POLL_INTERVAL = 3000; // 3 seconds

const fetcher = (url: string) => fetch(url).then((res) => res.json());

// Handler for approval decisions
async function handleApproval(approvalId: string, decision: "approve" | "deny") {
    try {
        const response = await fetch(`/api/approvals/${approvalId}/${decision}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({})
        });

        if (response.ok) {
            toast.success(decision === "approve" ? "Approved!" : "Denied");
        } else {
            const errorData = await response.json().catch(() => ({}));
            toast.error(errorData.error || "Failed to process approval");
        }
    } catch (error) {
        console.error("Approval error:", error);
        toast.error("Failed to process approval");
    }
}

export function useNotificationPoll() {
    const [isVisible, setIsVisible] = useState(true);

    // 1. Monitor Visibility
    useEffect(() => {
        const handleVisibilityChange = () => {
            setIsVisible(document.visibilityState === "visible");
        };

        // Initial check
        setIsVisible(document.visibilityState === "visible");

        document.addEventListener("visibilitychange", handleVisibilityChange);
        return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
    }, []);

    // 2. Poll only when visible
    const { data } = useSWR<{ notifications: Notification[] }>(
        isVisible ? "/api/notifications/poll" : null,
        fetcher,
        {
            refreshInterval: POLL_INTERVAL,
            revalidateOnFocus: true,
            dedupingInterval: 1000,
        }
    );

    // 3. Handle New Notifications
    useEffect(() => {
        if (data?.notifications && data.notifications.length > 0) {
            data.notifications.forEach((note) => {
                // Check if this is an approval notification
                if (note.type === "approval" && note.metadata?.approvalId) {
                    const approvalId = note.metadata.approvalId;
                    
                    // Show toast with Approve/Deny action buttons
                    toast(note.title, {
                        description: note.body,
                        duration: Infinity, // Don't auto-dismiss approvals
                        action: {
                            label: "Approve",
                            onClick: () => handleApproval(approvalId, "approve"),
                        },
                        cancel: {
                            label: "Deny",
                            onClick: () => handleApproval(approvalId, "deny"),
                        },
                    });
                } else {
                    // Regular notification toast
                    toast(note.title, {
                        description: note.body,
                    });
                }
            });

            // Refresh the history list if it's being viewed
            mutate("/api/notifications");
        }
    }, [data]);
}
