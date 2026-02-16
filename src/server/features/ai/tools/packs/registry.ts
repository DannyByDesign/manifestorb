import type { ToolPackManifest } from "@/server/features/ai/tools/packs/manifest-schema";
import { inboxToolPackManifest } from "@/server/features/ai/tools/packs/inbox/manifest";
import { calendarToolPackManifest } from "@/server/features/ai/tools/packs/calendar/manifest";
import { policyToolPackManifest } from "@/server/features/ai/tools/packs/policy/manifest";
import { memoryToolPackManifest } from "@/server/features/ai/tools/packs/memory/manifest";
import { webToolPackManifest } from "@/server/features/ai/tools/packs/web/manifest";

export function listInternalToolPacks(): ToolPackManifest[] {
  return [
    inboxToolPackManifest(),
    calendarToolPackManifest(),
    memoryToolPackManifest(),
    policyToolPackManifest(),
    webToolPackManifest(),
  ];
}
