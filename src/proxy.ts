import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { authkitMiddleware } from "@/server/auth";

const authMiddleware = authkitMiddleware();

function shouldBypassAuth(req: NextRequest): boolean {
  const { pathname } = req.nextUrl;
  const method = req.method.toUpperCase();

  if (pathname.startsWith("/api/health")) return true;
  if (pathname.startsWith("/api/surfaces/")) return true;

  // Sidecar/system approval flows.
  if (method === "POST" && pathname === "/api/approvals") return true;
  if (method === "POST" && /^\/api\/approvals\/[^/]+\/(approve|deny)$/.test(pathname)) {
    return true;
  }

  // Sidecar draft actions.
  if (method === "POST" && /^\/api\/drafts\/[^/]+\/send$/.test(pathname)) return true;
  if (method === "DELETE" && /^\/api\/drafts\/[^/]+$/.test(pathname)) return true;

  // Sidecar interactive resolutions.
  if (method === "POST" && /^\/api\/ambiguous-time\/[^/]+\/resolve$/.test(pathname)) {
    return true;
  }
  if (method === "POST" && /^\/api\/schedule-proposal\/[^/]+\/resolve$/.test(pathname)) {
    return true;
  }

  return false;
}

export default function proxy(req: NextRequest, event: NextFetchEvent) {
  if (shouldBypassAuth(req)) {
    return NextResponse.next();
  }

  return authMiddleware(req, event);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
