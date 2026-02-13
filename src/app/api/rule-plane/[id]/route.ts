import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/server/auth";
import { createScopedLogger } from "@/server/lib/logger";
import {
  disableRulePlaneRule,
  removeRulePlaneRule,
  updateRulePlaneRule,
} from "@/server/features/policy-plane/service";

const logger = createScopedLogger("api/rule-plane/by-id");

const patchBodySchema = z
  .object({
    disabled: z.boolean().optional(),
    disabledUntil: z.string().optional(),
    patch: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const body = patchBodySchema.safeParse(await req.json());
    if (!body.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: body.error.issues },
        { status: 400 },
      );
    }

    if (body.data.disabled === true) {
      const disabled = await disableRulePlaneRule({
        userId: session.user.id,
        id,
        disabledUntil: body.data.disabledUntil,
      });
      if (!disabled) {
        return NextResponse.json({ error: "Rule not found" }, { status: 404 });
      }
      return NextResponse.json({ rule: disabled });
    }

    const updated = await updateRulePlaneRule({
      userId: session.user.id,
      id,
      patch: body.data.patch as never,
    });
    if (!updated) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }
    return NextResponse.json({ rule: updated });
  } catch (error) {
    logger.error("Failed to update rule-plane rule", { error });
    return NextResponse.json(
      { error: "Failed to update rule-plane rule" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const removed = await removeRulePlaneRule({ userId: session.user.id, id });
    if (!removed.deleted) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to delete rule-plane rule", { error });
    return NextResponse.json(
      { error: "Failed to delete rule-plane rule" },
      { status: 500 },
    );
  }
}
