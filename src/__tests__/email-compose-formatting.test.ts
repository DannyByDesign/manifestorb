import { describe, expect, it } from "vitest";
import { createReplyContent } from "@/server/integrations/google/reply";
import { formatReplySubject } from "@/server/features/email/subject";

describe("email compose formatting", () => {
  it("adds a reply subject prefix when missing", () => {
    expect(formatReplySubject("Project update")).toBe("Re: Project update");
  });

  it("avoids double reply prefixes", () => {
    expect(formatReplySubject("Re: Project update")).toBe("Re: Project update");
  });

  it("quotes the original message in reply content", () => {
    const message = {
      headers: {
        from: "sender@example.com",
        date: "2024-02-01T12:34:00Z",
      },
      textPlain: "Line one\nLine two",
      textHtml: "<p>Line one</p><p>Line two</p>",
    };

    const result = createReplyContent({
      textContent: "Thanks for the update.",
      message,
    });

    expect(result.text).toContain("On");
    expect(result.text).toContain("wrote:");
    expect(result.text).toContain("> Line one");
    expect(result.html).toContain("gmail_quote");
    expect(result.html).toContain("blockquote");
  });
});
