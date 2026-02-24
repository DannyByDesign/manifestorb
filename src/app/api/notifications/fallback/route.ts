import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/server/db/client";
import { ChannelRouter } from "@/features/channels/router";

const requestSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

export async function POST(req: Request) {
  const body = requestSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: body.error.issues },
      { status: 400 },
    );
  }

  const notification = await prisma.inAppNotification.findUnique({
    where: { id: body.data.id },
    select: {
      id: true,
      userId: true,
      title: true,
      body: true,
      pushedToSurface: true,
    },
  });

  if (!notification) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  if (notification.pushedToSurface) {
    return NextResponse.json({ status: "already_pushed" });
  }

  const router = new ChannelRouter();
  const content = [notification.title, notification.body].filter(Boolean).join("\n\n");
  const pushed = await router.pushMessage(notification.userId, content);

  if (!pushed) {
    return NextResponse.json({ status: "not_pushed" }, { status: 503 });
  }

  const updated = await prisma.inAppNotification.updateMany({
    where: {
      id: notification.id,
      pushedToSurface: false,
    },
    data: {
      pushedToSurface: true,
      pushedAt: new Date(),
    },
  });

  if (updated.count === 0) {
    return NextResponse.json({ status: "already_pushed" });
  }

  return NextResponse.json({ status: "pushed" });
}
