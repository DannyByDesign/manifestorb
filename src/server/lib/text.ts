import type { PortableTextBlock } from "@portabletext/react";

/** Minimal type for a portable text span (text-bearing child). Avoids pulling in sanity. */
type TextSpan = { _type: string; text: string };

export const slugify = (text: string) => {
  return text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]+/g, "");
};

export const extractTextFromPortableTextBlock = (
  block: PortableTextBlock,
): string => {
  return block.children
    .filter(
      (child): child is TextSpan =>
        typeof child === "object" &&
        child !== null &&
        "_type" in child &&
        "text" in child,
    )
    .map((child) => child.text)
    .join("");
};
