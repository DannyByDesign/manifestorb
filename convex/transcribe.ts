import { v } from "convex/values";
import {
  action,
  internalMutation,
  mutation,
} from "./_generated/server";
import { internal } from "./_generated/api";

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const deleteAudio = internalMutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    await ctx.storage.delete(args.storageId);
  },
});

export const transcribe = action({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args): Promise<string> => {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error("GROQ_API_KEY is not set in Convex env");
    }

    const blob = await ctx.storage.get(args.storageId);
    if (!blob) {
      throw new Error("Audio file not found");
    }

    try {
      const filename = `audio.${extensionFromMime(blob.type)}`;
      const formData = new FormData();
      formData.append("file", blob, filename);
      formData.append("model", "whisper-large-v3-turbo");
      formData.append("response_format", "json");
      formData.append("language", "en");
      formData.append("temperature", "0");

      const response = await fetch(
        "https://api.groq.com/openai/v1/audio/transcriptions",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: formData,
        },
      );

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(
          `Groq transcription failed (${response.status}): ${errText.slice(0, 200)}`,
        );
      }

      const data = (await response.json()) as { text?: string };
      return (data.text ?? "").trim();
    } finally {
      await ctx
        .runMutation(internal.transcribe.deleteAudio, {
          storageId: args.storageId,
        })
        .catch(() => {});
    }
  },
});

function extensionFromMime(mime: string): string {
  const lower = (mime || "").toLowerCase();
  if (lower.includes("webm")) return "webm";
  if (lower.includes("ogg")) return "ogg";
  if (lower.includes("mp4") || lower.includes("m4a") || lower.includes("aac")) {
    return "m4a";
  }
  if (lower.includes("wav")) return "wav";
  if (lower.includes("mpeg") || lower.includes("mp3") || lower.includes("mpga")) {
    return "mp3";
  }
  if (lower.includes("flac")) return "flac";
  return "webm";
}
