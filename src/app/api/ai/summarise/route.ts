import { NextResponse } from "next/server";
import { summarise } from "@/app/api/ai/summarise/controller";
import { withEmailAccount } from "@/server/lib/middleware";
import { summariseBody } from "@/app/api/ai/summarise/validation";
import { getSummary } from "@/server/lib/redis/summary";
import { emailToContent } from "@/server/lib/mail";
import { getEmailAccountWithAi } from "@/server/lib/user/get";

export const POST = withEmailAccount(async (request) => {
  const emailAccountId = request.auth.emailAccountId;

  const json = await request.json();
  const body = summariseBody.parse(json);

  const prompt = emailToContent({
    textHtml: body.textHtml || undefined,
    textPlain: body.textPlain || undefined,
    snippet: "",
  });

  if (!prompt)
    return NextResponse.json({ error: "No text provided" }, { status: 400 });

  const cachedSummary = await getSummary(prompt);
  if (cachedSummary) return new NextResponse(cachedSummary);

  const userAi = await getEmailAccountWithAi({ emailAccountId });

  if (!userAi)
    return NextResponse.json({ error: "User not found" }, { status: 404 });

  const stream = await summarise({
    text: prompt,
    userEmail: userAi.email,
    userAi,
  });

  return stream.toTextStreamResponse();
});
