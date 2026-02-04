# Drive Feature (`src/server/features/drive`)

Drive integration: providers (Google/Microsoft), watch/webhooks, renewal cron, delete file/folder, and document filing. **File download is explicitly excluded** from the AI tool surface.

## Key Files
-   **`providers/`** — Google and Microsoft Drive providers; `deleteFile`, `deleteFolder` (exposed via AI `delete` tool).
-   **`filing-engine.ts`**, **`folder-utils.ts`** — Document filing and folder structure.
-   **Watch/renewal** — Drive watch and renewal cron are handled by the main app (`app/api/google/drive/watch/*`, `app/api/google/drive/watch/renew` with CRON_SECRET).
-   **Token management** — `providers/google-token.ts`, `providers/microsoft-token.ts`.
-   **Attachment/upload** — Integration with email attachments and storage (no download from Drive via tools).
