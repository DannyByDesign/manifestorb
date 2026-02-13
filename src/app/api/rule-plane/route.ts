import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/server/auth";
import { createScopedLogger } from "@/server/lib/logger";
import { findUserEmailAccountWithProvider } from "@/server/lib/user/email-account";
import {
  compileAndActivateRulePlaneRule,
  compileRulePlaneRule,
  createRulePlaneRule,
  listRulePlaneSnapshot,
} from "@/server/features/policy-plane/service";
import { canonicalRuleTypeSchema } from "@/server/features/policy-plane/canonical-schema";

const logger = createScopedLogger("api/rule-plane");

const createDirectSchema = z
  .object({
    mode: z.literal("direct"),
    rule: z.record(z.string(), z.unknown()),
  })
  .strict();

const compileSchema = z
  .object({
    mode: z.literal("compile"),
    input: z.string().min(1),
    activate: z.boolean().optional(),
  })
  .strict();

const postBodySchema = z.union([createDirectSchema, compileSchema]);

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const typeParam = req.nextUrl.searchParams.get("type");
    const type = typeParam
      ? canonicalRuleTypeSchema.safeParse(typeParam).data
      : undefined;

    const emailAccount = await findUserEmailAccountWithProvider({
      userId: session.user.id,
    });

    const snapshot = await listRulePlaneSnapshot({
      userId: session.user.id,
      emailAccountId: emailAccount?.id,
    });

    const rules = type
      ? snapshot.rules.filter((rule) => rule.type === type)
      : snapshot.rules;

    return NextResponse.json({
      ...snapshot,
      rules,
      source: "canonical_rule_plane",
    });
  } catch (error) {
    logger.error("Failed to list rule plane rules", { error });
    return NextResponse.json(
      { error: "Failed to list rule plane rules" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const emailAccount = await findUserEmailAccountWithProvider({
      userId: session.user.id,
    });
    if (!emailAccount) {
      return NextResponse.json({ error: "No email account linked" }, { status: 400 });
    }

    const body = postBodySchema.safeParse(await req.json());
    if (!body.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: body.error.issues },
        { status: 400 },
      );
    }

    if (body.data.mode === "compile") {
      if (body.data.activate) {
        const activated = await compileAndActivateRulePlaneRule({
          input: body.data.input,
          userId: session.user.id,
          emailAccount,
        });
        return NextResponse.json(activated);
      }

      const compiled = await compileRulePlaneRule({
        input: body.data.input,
        emailAccount,
      });
      return NextResponse.json({ activated: false, compiled, rule: null });
    }

    const rule = await createRulePlaneRule({
      userId: session.user.id,
      emailAccountId: emailAccount.id,
      rule: body.data.rule as never,
    });
    return NextResponse.json({ activated: true, rule });
  } catch (error) {
    logger.error("Failed to create rule-plane rule", { error });
    return NextResponse.json(
      { error: "Failed to create rule-plane rule" },
      { status: 500 },
    );
  }
}
