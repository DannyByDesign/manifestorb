import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { PrivacyService } from "@/server/privacy/service";
import prisma from "@/server/db/client";

export async function GET(req: Request) {
    const session = await auth();
    if (!session?.user?.id) return new NextResponse("Unauthorized", { status: 401 });

    const settings = await PrivacyService.getSettings(session.user.id);
    return NextResponse.json(settings);
}

export async function POST(req: Request) {
    const session = await auth();
    if (!session?.user?.id) return new NextResponse("Unauthorized", { status: 401 });

    const { recordHistory, retentionDays } = await req.json();

    const settings = await prisma.privacySettings.upsert({
        where: { userId: session.user.id },
        update: {
            recordHistory: typeof recordHistory === "boolean" ? recordHistory : undefined,
            retentionDays: typeof retentionDays === "number" ? retentionDays : undefined
        },
        create: {
            userId: session.user.id,
            recordHistory: recordHistory ?? true,
            retentionDays: retentionDays ?? 90
        }
    });

    return NextResponse.json(settings);
}
