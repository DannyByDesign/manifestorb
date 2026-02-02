import { withError } from "@/server/lib/middleware";
import { handleDriveCallback } from "@/features/drive/handle-drive-callback";
import { exchangeGoogleDriveCode } from "@/features/drive/client";

export const GET = withError("google/drive/callback", async (request) => {
  return handleDriveCallback(
    request,
    {
      name: "google",
      exchangeCodeForTokens: exchangeGoogleDriveCode,
    },
    request.logger,
  );
});
