import { NextResponse, type NextRequest } from "next/server";
import { authkitMiddleware } from "@/server/auth";
import { matchQuarantinedPath } from "@/lib/quarantine";

const authMiddleware = authkitMiddleware();
const AUTH_BYPASS_API_PREFIXES = [
  "/api/surfaces/",
  "/api/approvals/",
  "/api/drafts/",
  "/api/ambiguous-time/",
  "/api/health",
];

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (AUTH_BYPASS_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  const match = matchQuarantinedPath(req.nextUrl.pathname);
  if (match) {
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json(
        {
          error: "Endpoint is quarantined",
          reason: match.reason,
          path: req.nextUrl.pathname,
        },
        { status: 410 },
      );
    }

    return new NextResponse("This route is quarantined.", { status: 410 });
  }

  return authMiddleware(req);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
