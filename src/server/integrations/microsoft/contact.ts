
import type { Contact } from "@/features/email/types";
import { getClient } from "./client";

export async function searchContacts(
    emailAccountId: string,
    query: string
): Promise<Contact[]> {
    const client = await getClient(emailAccountId);

    const response = await client.getClient()
        .api("/me/contacts")
        .header("ConsistencyLevel", "eventual")
        .search(`"${query}"`)
        .select("id,displayName,givenName,surname,emailAddresses,businessPhones,mobilePhone,companyName,jobTitle")
        .top(20)
        .get();

    const validContacts = response.value || [];

    return validContacts.map((c: any) => ({
        id: c.id,
        name: c.displayName || `${c.givenName || ""} ${c.surname || ""}`.trim() || "Unknown",
        email: c.emailAddresses?.[0]?.address || "",
        phone: c.businessPhones?.[0] || c.mobilePhone,
        company: c.companyName,
        jobTitle: c.jobTitle,
        source: "microsoft"
    }));
}

export async function createContact(
    emailAccountId: string,
    contact: Partial<Contact>
): Promise<Contact> {
    const client = await getClient(emailAccountId);

    const payload: any = {
        givenName: contact.name ? contact.name.split(" ")[0] : undefined,
        surname: contact.name && contact.name.includes(" ") ? contact.name.split(" ").slice(1).join(" ") : undefined,
        emailAddresses: contact.email ? [{ address: contact.email, name: contact.name }] : undefined,
        businessPhones: contact.phone ? [contact.phone] : undefined,
        companyName: contact.company,
        jobTitle: contact.jobTitle,
    };

    const c = await client.getClient().api("/me/contacts").post(payload);

    return {
        id: c.id,
        name: c.displayName || `${c.givenName || ""} ${c.surname || ""}`.trim(),
        email: c.emailAddresses?.[0]?.address || "",
        phone: c.businessPhones?.[0] || c.mobilePhone,
        company: c.companyName,
        jobTitle: c.jobTitle,
        source: "microsoft"
    };
}
