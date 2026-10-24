import { APIError, type BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint, createAuthMiddleware, sessionMiddleware } from "better-auth/api";
import { deleteSessionCookie, setSessionCookie } from "better-auth/cookies";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { authRateLimits, type Db } from "@paperclipai/db";
import { LOCAL_PASSWORD_MAX_UTF16_LENGTH } from "@paperclipai/shared/local-password-policy";
import { withNativeAuthenticationTransaction, type NativeAuthenticationSchema } from "./native-authentication-transaction.js";
import { isAuthenticationStateBusy } from "./authenticator-assurance.js";

function rethrowAuthenticationFailure(error: unknown): never {
  if (isAuthenticationStateBusy(error)) throw new APIError("CONFLICT", {
    code: "authentication_state_busy", message: "Authentication state is changing; try again",
  });
  throw error;
}

/** Keep last in the native plugin list: the two-factor plugin must first remove
 * a password-only session when it issues a challenge. A cookie refresh, reset
 * link, SSO callback or historic session never manufactures local factor proof. */
export function nativeAuthenticationAssurancePlugin(db: Db, schema: NativeAuthenticationSchema): BetterAuthPlugin {
  async function recordPassword(tx: Pick<Db, "execute">, userId: string, sessionId: string, expectedVersion: number) {
    const [user] = await tx.execute<{ id: string }>(sql`
      select id from "user" where id=${userId}
        and authenticator_version=${expectedVersion} and not two_factor_enabled
        and not exists (select 1 from account_deletion_operations where user_id=${userId})
      for share nowait
    `);
    if (!user) return null;
    const sessions = await tx.execute<{ authenticatedAt: Date | string }>(sql`
      update "session" set authentication_method='password',
        authenticated_at=clock_timestamp(), authenticator_version=${expectedVersion}
      where id=${sessionId} and user_id=${user.id} and expires_at>clock_timestamp()
        and exists (select 1 from account where user_id=${user.id}
          and provider_id='credential' and password is not null)
      returning authenticated_at as "authenticatedAt"
    `);
    return sessions[0] ? { authenticationMethod: "password",
      authenticatedAt: new Date(sessions[0].authenticatedAt), authenticatorVersion: expectedVersion } : null;
  }
  return {
    id: "blentera-native-authentication-assurance",
    endpoints: {
      reauthenticatePassword: createAuthEndpoint("/reauthenticate/password", {
        method: "POST", use: [sessionMiddleware],
        body: z.object({ password: z.string().min(1).max(LOCAL_PASSWORD_MAX_UTF16_LENGTH) }),
      }, async (ctx) => {
        const { user, session } = ctx.context.session;
        // Reserve against the actual native session/user before verification.
        // This short transaction commits attempts independently of the verifier,
        // while erasure and credential changes cannot cross the reservation.
        const key = "password-reauth:" + createHash("sha256").update(user.id).digest("hex");
        const now = sql`floor(extract(epoch from statement_timestamp())*1000)::bigint`;
        const cutoff = sql`${now}-600000`;
        // Native session middleware returns public user fields. Capture the
        // actual server-side generation before verification, never after it.
        const snapshot = await db.transaction(async tx => {
          const [current] = await tx.execute<{ version: number }>(sql`
            select u.authenticator_version as version from "user" u join "session" s on s.user_id=u.id
            where u.id=${user.id} and s.id=${session.id} and s.expires_at>clock_timestamp()
              and not u.two_factor_enabled
              and not exists (select 1 from account_deletion_operations where user_id=u.id)
            for share of s,u nowait
          `);
          if (!current) return null;
          const [budget] = await tx.insert(authRateLimits).values({ id: randomUUID(), key, count: 1, lastRequest: now })
            .onConflictDoUpdate({ target: authRateLimits.key, set: {
              count: sql`case when ${authRateLimits.lastRequest}<${cutoff} then 1 else ${authRateLimits.count}+1 end`,
              lastRequest: sql`case when ${authRateLimits.lastRequest}<${cutoff} then ${now} else ${authRateLimits.lastRequest} end`,
            } }).returning();
          return { version: current.version, limited: budget!.count > 10 };
        }).catch(rethrowAuthenticationFailure);
        if (!snapshot) throw new APIError("UNAUTHORIZED", {
          code: "AUTHENTICATION_STATE_CHANGED", message: "Authenticate again to continue",
        });
        // Denial happens after commit, so rejected attempts keep their budget.
        if (snapshot.limited) throw new APIError("TOO_MANY_REQUESTS", {
          code: "REAUTHENTICATION_RATE_LIMITED", message: "Too many confirmation attempts; try again later",
        });
        await ctx.context.password.checkPassword(user.id, ctx);
        await withNativeAuthenticationTransaction(db, ctx, schema, async tx => {
          // Lock the old session exclusively so concurrent confirmations cannot
          // both rotate it. Pin the pre-verification credential generation.
          const [current] = await tx.execute<{ id: string }>(sql`
            select s.id from "session" s join "user" u on u.id=s.user_id
            where s.id=${session.id} and u.id=${user.id} and s.expires_at>clock_timestamp()
              and u.authenticator_version=${snapshot.version} and not u.two_factor_enabled
              and not exists (select 1 from account_deletion_operations where user_id=u.id)
            for update of s nowait for share of u nowait
          `);
          const proof = current && await recordPassword(tx, user.id, session.id, snapshot.version);
          const freshUser = proof && await ctx.context.internalAdapter.findUserById(user.id);
          if (!proof || !freshUser) throw new APIError("UNAUTHORIZED", {
            code: "AUTHENTICATION_STATE_CHANGED", message: "Authenticate again to continue",
          });
          const dontRemember = !!await ctx.getSignedCookie(
            ctx.context.authCookies.dontRememberToken.name, ctx.context.secret);
          const freshSession = await ctx.context.internalAdapter.createSession(
            user.id, dontRemember, proof, true, { deferSecondaryStorageWrites: true });
          await setSessionCookie(ctx, { session: freshSession, user: freshUser }, dontRemember);
          await ctx.context.internalAdapter.deleteSession(session.token);
          ctx.context.session = { session: freshSession, user: freshUser };
        }).catch(rethrowAuthenticationFailure);
        return ctx.json({ status: true });
      }),
    },
    rateLimit: [{ pathMatcher: (path) => path === "/reauthenticate/password", window: 60, max: 5 }],
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
          accepted = expectedVersion !== null && Boolean(await db.transaction(tx => recordPassword(tx, created.user.id, created.session.id, expectedVersion)));
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
