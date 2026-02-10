import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import prisma, { resetPrismaMock } from "@/server/lib/__mocks__/prisma";

vi.mock("@/server/db/client");

describe("POST /api/surfaces/context", () => {
    beforeEach(() => {
        resetPrismaMock();
        process.env.SURFACES_SHARED_SECRET = "secret";
    });

    afterEach(() => {
        delete process.env.SURFACES_SHARED_SECRET;
    });

    it("returns 401 when unauthorized", async () => {
        const { POST } = await import("./route");
        const req = new NextRequest("http://localhost/api/surfaces/context", {
            method: "POST",
            body: JSON.stringify({}),
        });
        const res = await POST(req);
        expect(res.status).toBe(401);
    });

    it("returns linked false when account is not found", async () => {
        prisma.account.findUnique.mockResolvedValue(null);

        const { POST } = await import("./route");
        const req = new NextRequest("http://localhost/api/surfaces/context", {
            method: "POST",
            headers: { "x-surfaces-secret": "secret" },
            body: JSON.stringify({
                provider: "slack",
                providerAccountId: "U123",
                channelId: "C123",
                messageId: "111.222",
            }),
        });

        const res = await POST(req);
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json).toEqual({
            linked: false,
            canonicalThreadId: "111.222",
        });
    });

    it("returns conversation thread when linked account has canonical conversation", async () => {
        prisma.account.findUnique.mockResolvedValue({ userId: "user-1" } as never);
        prisma.conversation.findFirst
            .mockResolvedValueOnce({
                id: "conv-1",
                channelId: "C123",
                threadId: "111.222",
            } as never);

        const { POST } = await import("./route");
        const req = new NextRequest("http://localhost/api/surfaces/context", {
            method: "POST",
            headers: { "x-surfaces-secret": "secret" },
            body: JSON.stringify({
                provider: "slack",
                providerAccountId: "U123",
                channelId: "C123",
                messageId: "111.222",
            }),
        });

        const res = await POST(req);
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.linked).toBe(true);
        expect(json.canonicalThreadId).toBe("111.222");
        expect(json.conversationId).toBe("conv-1");
        expect(prisma.conversation.findFirst).toHaveBeenCalledWith({
            where: {
                userId: "user-1",
                provider: "slack",
                channelId: "C123",
                threadId: "111.222",
            },
            select: {
                id: true,
                channelId: true,
                threadId: true,
            },
        });
    });

    it("recovers latest canonical thread when incoming thread is missing", async () => {
        prisma.account.findUnique.mockResolvedValue({ userId: "user-1" } as never);
        prisma.conversation.findFirst
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({
                id: "conv-latest",
                channelId: "C123",
                threadId: "1717682630.123456",
            } as never);

        const { POST } = await import("./route");
        const req = new NextRequest("http://localhost/api/surfaces/context", {
            method: "POST",
            headers: { "x-surfaces-secret": "secret" },
            body: JSON.stringify({
                provider: "slack",
                providerAccountId: "U123",
                channelId: "C123",
                messageId: "999.000",
            }),
        });

        const res = await POST(req);
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.linked).toBe(true);
        expect(json.canonicalThreadId).toBe("1717682630.123456");
        expect(json.conversationId).toBe("conv-latest");
        expect(prisma.conversation.findFirst).toHaveBeenNthCalledWith(2, {
            where: {
                userId: "user-1",
                provider: "slack",
                channelId: "C123",
                threadId: { not: null },
            },
            orderBy: {
                updatedAt: "desc",
            },
            select: {
                id: true,
                channelId: true,
                threadId: true,
            },
        });
    });

    it("falls back to incoming thread when no stored thread exists", async () => {
        prisma.account.findUnique.mockResolvedValue({ userId: "user-1" } as never);
        prisma.conversation.findFirst.mockResolvedValueOnce(null);

        const { POST } = await import("./route");
        const req = new NextRequest("http://localhost/api/surfaces/context", {
            method: "POST",
            headers: { "x-surfaces-secret": "secret" },
            body: JSON.stringify({
                provider: "slack",
                providerAccountId: "U123",
                channelId: "C123",
                incomingThreadId: "thread-inbound",
                messageId: "111.222",
            }),
        });

        const res = await POST(req);
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.linked).toBe(true);
        expect(json.canonicalThreadId).toBe("thread-inbound");
    });

    it("uses root thread for threadless providers", async () => {
        prisma.account.findUnique.mockResolvedValue({ userId: "user-1" } as never);
        prisma.conversation.findFirst.mockResolvedValueOnce(null);

        const { POST } = await import("./route");
        const req = new NextRequest("http://localhost/api/surfaces/context", {
            method: "POST",
            headers: { "x-surfaces-secret": "secret" },
            body: JSON.stringify({
                provider: "discord",
                providerAccountId: "U123",
                channelId: "C123",
                messageId: "m-1",
            }),
        });

        const res = await POST(req);
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.linked).toBe(true);
        expect(json.canonicalThreadId).toBe("root");
        expect(prisma.conversation.findFirst).toHaveBeenCalledWith({
            where: {
                userId: "user-1",
                provider: "discord",
                channelId: "C123",
                threadId: "root",
            },
            select: {
                id: true,
                channelId: true,
                threadId: true,
            },
        });
    });
});
