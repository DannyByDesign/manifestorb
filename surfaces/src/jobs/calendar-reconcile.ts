import { env } from "../env";

export async function runCalendarReconcile(): Promise<void> {
  if (!env.INTERNAL_API_KEY) {
    console.error("[Scheduler] INTERNAL_API_KEY missing for calendar reconcile");
    return;
  }

  try {
    const response = await fetch(
      new URL("/api/calendar/sync/reconcile", env.CORE_BASE_URL).toString(),
      {
        method: "POST",
        headers: {
          "x-api-key": env.INTERNAL_API_KEY,
        },
      },
    );

    if (!response.ok) {
      const text = await response.text();
      console.error("[Scheduler] Calendar reconcile failed", text);
      return;
    }

    const result = await response.json();
    console.log("[Scheduler] Calendar reconcile complete", result);
  } catch (error) {
    console.error("[Scheduler] Calendar reconcile error", error);
  }
}
