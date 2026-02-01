import { google } from "googleapis";
import { getContactsClientWithRefresh } from "./client";
import type { Contact } from "@/server/services/email/types";
import { getEmailAccountWithAiAndTokens } from "@/server/utils/user/get";
import { SafeError } from "@/server/utils/error";
import { createScopedLogger } from "@/server/utils/logger";

export async function searchGoogleContacts(
    emailAccountId: string,
    query: string
): Promise<Contact[]> {
    const account = await getEmailAccountWithAiAndTokens({ emailAccountId });
    if (!account || !account.tokens.access_token) throw new SafeError(`Email account not found or missing tokens: ${emailAccountId}`);

    const client = await getContactsClientWithRefresh({
        accessToken: account.tokens.access_token,
        refreshToken: account.tokens.refresh_token!,
        expiresAt: account.tokens.expires_at,
        emailAccountId,
        logger: createScopedLogger("google-contacts")
    });

    const response = await client.people.searchContacts({
        query,
        readMask: "names,emailAddresses,phoneNumbers,organizations",
    });

    const connections = response.data.results || [];

    return connections.map((c) => {
        const person = c.person;
        if (!person) return { name: "Unknown", source: "google" as const, id: undefined, email: "", phone: undefined, company: undefined, jobTitle: undefined };

        const name = person.names?.[0]?.displayName || "Unknown";
        const email = person.emailAddresses?.[0]?.value || "";
        const phone = person.phoneNumbers?.[0]?.value || undefined;
        const company = person.organizations?.[0]?.name || undefined;
        const jobTitle = person.organizations?.[0]?.title || undefined;

        return {
            id: person.resourceName || undefined,
            name,
            email,
            phone: phone || undefined,
            company: company || undefined,
            jobTitle: jobTitle || undefined,
            source: "google"
        };
    });
}

export async function createGoogleContact(
    emailAccountId: string,
    contact: Partial<Contact>
): Promise<Contact> {
    const account = await getEmailAccountWithAiAndTokens({ emailAccountId });
    if (!account || !account.tokens.access_token) throw new SafeError(`Email account not found or missing tokens: ${emailAccountId}`);

    const client = await getContactsClientWithRefresh({
        accessToken: account.tokens.access_token,
        refreshToken: account.tokens.refresh_token!,
        expiresAt: account.tokens.expires_at,
        emailAccountId,
        logger: createScopedLogger("google-contacts")
    });

    const response = await client.people.createContact({
        requestBody: {
            names: contact.name ? [{ givenName: contact.name }] : undefined,
            emailAddresses: contact.email ? [{ value: contact.email }] : undefined,
            phoneNumbers: contact.phone ? [{ value: contact.phone }] : undefined,
            organizations: (contact.company || contact.jobTitle) ? [{
                name: contact.company,
                title: contact.jobTitle
            }] : undefined
        }
    });

    const person = response.data;

    return {
        id: person.resourceName || undefined,
        name: person.names?.[0]?.displayName || contact.name || "Unknown",
        email: person.emailAddresses?.[0]?.value || contact.email || "",
        phone: person.phoneNumbers?.[0]?.value || undefined,
        company: person.organizations?.[0]?.name || undefined,
        jobTitle: person.organizations?.[0]?.title || undefined,
        source: "google"
    };
}
