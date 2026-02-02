import { z } from "zod";
import { NextResponse } from "next/server";
import { withEmailAccount } from "@/server/utils/middleware";
import { searchGoogleContacts } from "@/server/integrations/google/contact";
import { env } from "@/env";

const contactsQuery = z.object({ query: z.string() });
export type ContactsQuery = z.infer<typeof contactsQuery>;

export const GET = withEmailAccount("google/contacts", async (request) => {
  if (!env.NEXT_PUBLIC_CONTACTS_ENABLED)
    return NextResponse.json({ error: "Contacts API not enabled" });

  const emailAccountId = request.auth.emailAccountId;

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("query");
  const searchQuery = contactsQuery.parse({ query });

  const result = await searchGoogleContacts(emailAccountId, searchQuery.query);

  return NextResponse.json({ result });
});
