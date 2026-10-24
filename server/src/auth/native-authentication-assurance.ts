import { APIError, type BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { deleteSessionCookie } from "better-auth/cookies";
import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";

/** Keep last in the native plugin list: the two-factor plugin must first remove
 * a password-only session when it issues a challenge. A cookie refresh, reset
 * link, SSO callback or historic session never manufactures local factor proof. */
export function nativeAuthenticationAssurancePlugin(db: Db): BetterAuthPlugin {
  return {
    id: "blentera-native-authentication-assurance",
    schema: {
      user: { fields: {
        authenticatorVersion: { type: "number", required: true, defaultValue: 0, input: false, returned: false },
        phishingResistantRequired: { type: "boolean", required: true, defaultValue: false, input: false, returned: false },
      } },
      session: { fields: {
        authenticationMethod: { type: "string", required: false, input: false, returned: false },
        authenticatedAt: { type: "date", required: false, input: false, returned: false },
        authenticatorVersion: { type: "number", required: false, input: false, returned: false },
      } },
    },
    hooks: { after: [{
      matcher: (ctx) => ctx.path === "/sign-in/email" || ctx.path === "/sign-up/email",
      handler: createAuthMiddleware(async (ctx) => {
        const created = ctx.context.newSession;
        if (!created || ctx.context.returned instanceof APIError) return;
        const capturedVersion: unknown = created.user.authenticatorVersion;
        // Signup creates its credential after creating the user; the actual
        // credential INSERT increments the generation once in that transaction.
        const expectedVersion = typeof capturedVersion === "number" && Number.isSafeInteger(capturedVersion)
          && capturedVersion >= 0 ? capturedVersion + (ctx.path === "/sign-up/email" ? 1 : 0) : null;
        let accepted = false;
        try {
          accepted = expectedVersion !== null && await db.transaction(async (tx) => {
            const [user] = await tx.execute<{ id: string }>(sql`
              select id from "user" where id=${created.user.id}
                and authenticator_version=${expectedVersion} and not two_factor_enabled
              for share nowait
            `);
            if (!user) return false;
            const sessions = await tx.execute<{ id: string }>(sql`
              update "session" set authentication_method='password',
                authenticated_at=clock_timestamp(), authenticator_version=${expectedVersion}
              where id=${created.session.id} and user_id=${user.id}
                and expires_at>clock_timestamp()
                and exists (select 1 from account where user_id=${user.id}
                  and provider_id='credential' and password is not null)
              returning id
            `);
            return sessions.length === 1;
          });
        } catch {
          // A competing credential mutation holds the user row. Never return a
          // native success/cookie whose verified generation could not be pinned.
        }
        if (accepted) return;
        deleteSessionCookie(ctx);
        ctx.context.setNewSession(null);
        await ctx.context.internalAdapter.deleteSession(created.session.token);
        throw new APIError("UNAUTHORIZED", {
          code: "AUTHENTICATION_STATE_CHANGED", message: "Authenticate again to continue",
        });
      }),
    }] },
  };
}
