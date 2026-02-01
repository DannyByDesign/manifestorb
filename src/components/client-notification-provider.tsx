
"use client";

import { Toaster } from "sonner";
import { useNotificationPoll } from "@/hooks/use-notification-poll";

export function ClientNotificationProvider() {
    // Start Polling
    useNotificationPoll();

    return <Toaster position="top-right" />;
}
