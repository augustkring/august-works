import { authSecurityEvents, type Db } from "@paperclipai/db";
import {
  v6FeatureEnabled,
  type PublicOriginConfig,
  type V6FeatureFlags,
} from "@paperclipai/shared";
import type { SaasAuthDelivery } from "../../auth/better-auth.js";
import type { transactionalEmail } from "../notifications/transactional-email.js";
import { sha256 } from "./crypto.js";

export function saasAuthDelivery(
  db: Db,
  email: ReturnType<typeof transactionalEmail>,
  origins: PublicOriginConfig,
  flags: Partial<V6FeatureFlags>,
): SaasAuthDelivery | undefined {
  if (!v6FeatureEnabled(flags, "transactional_email_v6")) return undefined;
  async function audit(
    userId: string,
    action: typeof authSecurityEvents.$inferInsert.action,
  ) {
    await db
      .insert(authSecurityEvents)
      .values({
        userId,
        action,
        expiresAt: new Date(Date.now() + 90 * 86400000),
      });
  }
  async function send(
    input: { user: { id: string; email: string }; url: string; token: string },
    purpose: "verification" | "password_reset",
  ) {
    const url = new URL(input.url);
    if (url.origin !== origins.primaryAppOrigin)
      throw new Error("Authentication action origin mismatch");
    const expectedPath =
      purpose === "verification"
        ? "/api/auth/verify-email"
        : "/api/auth/reset-password/";
    if (
      purpose === "verification"
        ? url.pathname !== expectedPath
        : !url.pathname.startsWith(expectedPath)
    )
      throw new Error("Authentication action path mismatch");
    // Better Auth owns token verification; the outbox stores only encrypted, expiring native action paths.
    if (purpose === "verification")
      url.searchParams.set(
        "callbackURL",
        origins.primaryAppOrigin + "/saas/welcome",
      );
    else
      url.searchParams.set(
        "callbackURL",
        origins.primaryAppOrigin + "/saas/reset-password",
      );
    await email.enqueue({
      purpose,
      recipient: input.user.email,
      userId: input.user.id,
      subject:
        purpose === "verification"
          ? "Verify your August Works email"
          : "Reset your August Works password",
      actionPath: url.pathname + url.search,
      message:
        purpose === "verification"
          ? "Confirm your email to continue setting up your organization."
          : "Use this link to reset your password. If you did not request this, you can ignore this email.",
      dedupeKey:
        "auth:" + purpose + ":" + input.user.id + ":" + sha256(input.token),
      expiresAt: new Date(
        Date.now() + (purpose === "verification" ? 3600000 : 900000),
      ),
    });
    await audit(
      input.user.id,
      purpose === "verification"
        ? "verification_requested"
        : "password_reset_requested",
    );
  }
  return {
    signupEnabled: v6FeatureEnabled(flags, "saas_self_signup_v6"),
    verificationRequired: v6FeatureEnabled(
      flags,
      "email_verification_required_v6",
    ),
    sendVerification: (input) => send(input, "verification"),
    sendPasswordReset: (input) => send(input, "password_reset"),
    recordSecurityEvent: audit,
  };
}
