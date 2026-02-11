/**
 * QStash signature verification wrapper for Next.js App Router routes.
 *
 * We lazy-load the Upstash verifier so `next build` doesn't crash when
 * QStash signing keys are not present (common in non-cron environments).
 *
 * At runtime, missing keys will still surface as an error (as intended).
 */
export function withQStashSignatureAppRouter(
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const mod = await import("@upstash/qstash/nextjs");
    const verifySignatureAppRouter = (mod as unknown as { verifySignatureAppRouter: unknown })
      .verifySignatureAppRouter as (h: (req: Request) => Promise<Response>) => (req: Request) => Promise<Response>;
    return verifySignatureAppRouter(handler)(req);
  };
}

