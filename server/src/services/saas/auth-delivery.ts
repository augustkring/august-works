import { PRODUCT_IDENTITY } from "@paperclipai/shared/product-identity";
import { isAuthMailLocale, renderAuthMailCopy, type AuthMailLocale } from "@paperclipai/shared/auth-mail-copy";
import { authSecurityEvents, type Db } from "@paperclipai/db";
import { sql } from "drizzle-orm";
import {
  v6FeatureEnabled,
  type PublicOriginConfig,
  type V6FeatureFlags,
} from "@paperclipai/shared";
import type { SaasAuthDelivery } from "../../auth/better-auth.js";
import type { transactionalEmail } from "../notifications/transactional-email.js";
import { sha256 } from "./crypto.js";

/** Native retention runs for every deployment, independently of email delivery. */
export async function pruneExpiredAuthSecurityEvents(db: Db, now = new Date()) {
  return db.execute(sql`delete from ${authSecurityEvents}
    where ${authSecurityEvents.expiresAt} < ${now.toISOString()}::timestamptz
      and ${authSecurityEvents.id} in (
        select ${authSecurityEvents.id} from ${authSecurityEvents}
        where ${authSecurityEvents.expiresAt} < ${now.toISOString()}::timestamptz
        order by ${authSecurityEvents.expiresAt}, ${authSecurityEvents.id} limit 1000
      ) returning ${authSecurityEvents.id}`);
}

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
    input: { user: { id: string; email: string; locale?: unknown }; url: string; token: string },
    purpose: "verification" | "password_reset",
    request?: Request,
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
    const requestedLocale = request?.headers.get("X-Blentera-Locale");
    const locale: AuthMailLocale = isAuthMailLocale(input.user.locale)
      ? input.user.locale
      : isAuthMailLocale(requestedLocale)
        ? requestedLocale
        : "en";
    // Preserve known native return context such as the legacy onboarding route.
    // Never let callback input redirect away from the fixed in-app destinations.
    const callbackPath = purpose === "verification" ? "/saas/welcome" : "/saas/reset-password";
    const callbackParam = url.searchParams.get("callbackURL");
    let callback = new URL(callbackPath, origins.primaryAppOrigin);
    if (callbackParam) {
      try {
        const candidate = new URL(callbackParam, origins.primaryAppOrigin);
        if (candidate.origin === origins.primaryAppOrigin && candidate.pathname === callbackPath)
          callback = candidate;
      } catch {
        // Invalid callback context falls back to the fixed native route.
      }
    }
    callback.searchParams.set("locale", locale);
    url.searchParams.set("callbackURL", callback.href);
    // Better Auth owns token verification; the outbox stores only encrypted, expiring native action paths.
    const copy = renderAuthMailCopy(locale, purpose, PRODUCT_IDENTITY.productName);
    await email.enqueue({
      purpose,
      recipient: input.user.email,
      userId: input.user.id,
      subject: copy.subject,
      actionPath: url.pathname + url.search,
      message: copy.message,
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
    sendVerification: (input, request) => send(input, "verification", request),
    sendPasswordReset: (input, request) => send(input, "password_reset", request),
    recordSecurityEvent: audit,
  };
}
