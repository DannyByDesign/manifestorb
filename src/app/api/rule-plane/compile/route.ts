import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/server/auth";
import { createScopedLogger } from "@/server/lib/logger";
import { findUserEmailAccountWithProvider } from "@/server/lib/user/email-account";
import { compileRulePlaneRule } from "@/server/features/policy-plane/service";

const logger = createScopedLogger("api/rule-plane/compile");

const bodySchema = z
  .object({
    input: z.string().min(1),
  })
  .strict();

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = bodySchema.safeParse(await req.json());
    if (!body.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: body.error.issues },
        { status: 400 },
      );
    }

    const emailAccount = await findUserEmailAccountWithProvider({
      userId: session.user.id,
    });
    if (!emailAccount) {
      return NextResponse.json({ error: "No email account linked" }, { status: 400 });
    }

    const compiled = await compileRulePlaneRule({
      input: body.data.input,
      emailAccount,
    });

    return NextResponse.json({ compiled });
  } catch (error) {
    logger.error("Failed to compile rule", { error });
    return NextResponse.json(
      { error: "Failed to compile rule" },
      { status: 500 },
    );
  }
}
