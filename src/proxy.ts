import { authkitMiddleware } from "@/server/auth";

export default authkitMiddleware();

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
