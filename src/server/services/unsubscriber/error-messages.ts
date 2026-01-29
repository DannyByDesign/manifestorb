"use server";

import { revalidatePath } from "next/cache";
import { clearUserErrorMessages } from "@/server/utils/error-messages";
import { actionClientUser } from "@/server/services/unsubscriber/safe-action";

export const clearUserErrorMessagesAction = actionClientUser
  .metadata({ name: "clearUserErrorMessages" })
  .action(async ({ ctx: { userId, logger } }) => {
    await clearUserErrorMessages({ userId, logger });
    revalidatePath("/(app)", "layout");
  });
