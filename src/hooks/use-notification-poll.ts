
"use client";

import { useEffect, useState } from "react";
import useSWR, { mutate } from "swr";
import { toast } from "sonner";
import { type InAppNotification } from "@prisma/client";

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
                // Show Toast
                // Using Sonner
                toast(note.title, {
                    description: note.body,
                    // Map type to color/icon if needed
                });
            });

            // Refresh the history list if it's being viewed
            mutate("/api/notifications");
        }
    }, [data]);
}
