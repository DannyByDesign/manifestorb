"use server";

import { revalidatePath } from "next/cache";
import { announcementDismissedBody } from "@/server/services/unsubscriber/announcements.validation";
import { actionClientUser } from "@/server/services/unsubscriber/safe-action";
import prisma from "@/server/db/client";

export const dismissAnnouncementModalAction = actionClientUser
  .metadata({ name: "dismissAnnouncementModal" })
  .schema(announcementDismissedBody)
  .action(async ({ ctx: { userId }, parsedInput: { publishedAt } }) => {
    const dismissedAt = new Date(new Date(publishedAt).getTime() + 1000);

    await prisma.user.update({
      where: { id: userId },
      data: {
        announcementDismissedAt: dismissedAt,
      },
    });

    revalidatePath("/");

    return { success: true };
  });
