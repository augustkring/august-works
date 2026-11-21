import { APIError, createAuthMiddleware } from "better-auth/api";
import { hasValidNewLocalPasswordLength, LOCAL_PASSWORD_MIN_LENGTH, LOCAL_PASSWORD_MAX_UTF16_LENGTH } from "@paperclipai/shared/local-password-policy";
import { commonPasswords } from "./common-passwords.js";

const blocked = new Set(commonPasswords);

/** Validate writes, not hashing: native sign-in also hashes unknown-user inputs
 * for timing mitigation, and must keep the same error for existing accounts. */
export const localPasswordPolicy = createAuthMiddleware(async ctx => {
  const signup = ctx.path === "/sign-up/email";
  const setPassword = "operationId" in ctx && ctx.operationId === "setPassword";
  if (!signup && ctx.path !== "/reset-password" && ctx.path !== "/change-password" && !setPassword) return;
  const password = ctx.body?.[signup ? "password" : "newPassword"];
  if (typeof password !== "string") return; // Original endpoint owns shape validation.
  if (!hasValidNewLocalPasswordLength(password)) {
    const short = password.length <= LOCAL_PASSWORD_MAX_UTF16_LENGTH && [...password].length < LOCAL_PASSWORD_MIN_LENGTH;
    throw new APIError("BAD_REQUEST", { code: short ? "PASSWORD_TOO_SHORT" : "PASSWORD_TOO_LONG",
      message: "Choose a password with 15 to 128 characters." });
  }
  if (blocked.has(password.normalize("NFKC").toLowerCase()))
    throw new APIError("BAD_REQUEST", { code: "PASSWORD_TOO_COMMON", message: "Choose a less common password." });
});
