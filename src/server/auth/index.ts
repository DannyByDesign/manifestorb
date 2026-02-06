/**
 * Single entry point for authentication (WorkOS AuthKit).
 * All session logic and WorkOS usage lives under src/server/auth/.
 */

export { auth, saveTokens, handleReferralOnSignUp } from "./session";

export {
  authkitMiddleware,
  getSignInUrl,
  handleAuth,
  signOut,
} from "@workos-inc/authkit-nextjs";
