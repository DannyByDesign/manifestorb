import type { SearchChunkInput } from "@/server/features/search/index/types";

const MAX_CHUNK_CHARS = 1200;
const OVERLAP_CHARS = 120;

function estimateTokenCount(text: string): number {
  const tokens = text.trim().split(/\s+/u).filter((token) => token.length > 0);
  return tokens.length;
}

export function buildSearchChunks(text: string | undefined): SearchChunkInput[] {
  const source = (text ?? "").trim();
  if (!source) return [];

  const chunks: SearchChunkInput[] = [];
  let offset = 0;
  let ordinal = 0;

  while (offset < source.length) {
    const end = Math.min(offset + MAX_CHUNK_CHARS, source.length);
    const content = source.slice(offset, end).trim();
    if (content.length > 0) {
      chunks.push({
        ordinal,
        content,
        tokenCount: estimateTokenCount(content),
      });
      ordinal += 1;
    }

    if (end >= source.length) break;
    offset = Math.max(0, end - OVERLAP_CHARS);
  }

  return chunks;
}
