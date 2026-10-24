import { createHash, createHmac, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { APIError, type GenericEndpointContext } from "better-auth";
import { changePassword as nativeChangePassword, createAuthEndpoint, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { deleteSessionCookie, expireCookie, setSessionCookie } from "better-auth/cookies";
import { twoFactor } from "better-auth/plugins";
import { parseUserOutput } from "better-auth/db";
import { authRateLimits, type Db } from "@paperclipai/db";
import { assertHumanAuthentication, isAuthenticationStateBusy } from "./authenticator-assurance.js";
import { withNativeAuthenticationTransaction, type NativeAuthenticationSchema } from "./native-authentication-transaction.js";

type NativeEndpoint = ReturnType<typeof twoFactor>["endpoints"][
  "enableTwoFactor" | "disableTwoFactor" | "generateBackupCodes" | "getTOTPURI" | "verifyTOTP" | "verifyBackupCode"] | typeof nativeChangePassword;
type NativeResponse = { headers: Headers; response: Record<string, unknown>; status: Parameters<GenericEndpointContext["setStatus"]>[0] };
type Operation = "enable" | "disable" | "codes" | "uri" | "totp" | "backup_code";
type FactorSnapshot = {
  userId: string; version: number; enabled: boolean; phishingResistantRequired: boolean; factorId: string | null;
  secret: string | null; verified: boolean | null; sessionId?: string; sessionToken?: string;
};

function deny(): never {
  throw new APIError("UNAUTHORIZED", { code: "AUTHENTICATION_STATE_CHANGED", message: "Authenticate again to continue" });
}
function nativeFailure(error: unknown): never {
  if (isAuthenticationStateBusy(error)) throw new APIError("CONFLICT", {
    code: "authentication_state_busy", message: "Authentication state is changing; try again",
  });
  if (error && typeof error === "object" && "status" in error && error.status === 403) {
    throw new APIError("FORBIDDEN", { code: "recent_authentication_required", message: "Authenticate again to continue" });
  }
  throw error;
}

/** Maintained TOTP/recovery verifiers own cryptography, one-use consumption and
 * lockout. This boundary pins their actual first-factor generation and publishes
 * completed proof; configuration never becomes a substitute authentication event. */
export function nativeTwoFactorPlugin(db: Db, schema: NativeAuthenticationSchema, operatorUserIds: readonly string[]) {
  const native = twoFactor({ issuer: "Blentera", skipVerificationOnEnable: false, allowPasswordless: true });

  async function invoke(ctx: GenericEndpointContext, endpoint: NativeEndpoint) {
    // These native overloads share the same wire contract when both return
    // flags are true; their distinct validated body types form an uncallable union.
    const call = endpoint as unknown as (input: GenericEndpointContext & { asResponse: false; returnHeaders: true; returnStatus: true }) => Promise<NativeResponse>;
    const result = await call({ ...ctx, asResponse: false, returnHeaders: true, returnStatus: true });
    for (const [key, value] of result.headers) if (key.toLowerCase() !== "set-cookie") ctx.setHeader(key, value);
    for (const cookie of result.headers.getSetCookie()) ctx.responseHeaders.append("set-cookie", cookie);
    ctx.setStatus(result.status);
    return result.response;
  }

  async function snapshot(ctx: GenericEndpointContext, reserveAttempt: boolean): Promise<FactorSnapshot> {
    const session = await getSessionFromCtx(ctx);
    const cookie = ctx.context.createAuthCookie("two_factor");
    const nonce = !session && await ctx.getSignedCookie(cookie.name, ctx.context.secret);
    if (!session && !nonce) deny();
    const result = await db.transaction(async tx => {
      const [owner] = await tx.execute<FactorSnapshot>(sql`
        select u.id as "userId",u.authenticator_version as version,u.two_factor_enabled as enabled,u.phishing_resistant_required as "phishingResistantRequired",
          f.id as "factorId",f.secret,f.verified
        from "user" u left join two_factor f on f.user_id=u.id
        where ${session ? sql`u.id=${session.user.id} and exists(select 1 from "session" s
          where s.id=${session.session.id} and s.user_id=u.id and s.expires_at>clock_timestamp())`
          : sql`exists(select 1 from verification v where v.identifier=${nonce} and v.value=u.id
            and v.expires_at>clock_timestamp() and v.authenticator_version=u.authenticator_version)`}
          and not exists(select 1 from account_deletion_operations where user_id=u.id)
        for share of u nowait
      `);
      if (!owner) deny();
      if (session) {
        await assertHumanAuthentication(tx, { type: "board", source: "session", userId: owner.userId,
          sessionId: session.session.id }, { requireRecent: !reserveAttempt,
          phishingResistant: operatorUserIds.includes(owner.userId) });
      } else if (operatorUserIds.includes(owner.userId)) {
        // A password challenge plus TOTP cannot authenticate a platform operator.
        throw new APIError("FORBIDDEN", { code: "PHISHING_RESISTANT_AUTHENTICATION_REQUIRED",
          message: "Sign in with your passkey" });
      }
      if (reserveAttempt && (owner.phishingResistantRequired || operatorUserIds.includes(owner.userId))) {
        throw new APIError("FORBIDDEN", { code: "PHISHING_RESISTANT_AUTHENTICATION_REQUIRED", message: "Use your passkey" });
      }
      if (!reserveAttempt) return { owner, limited: false };
      const key = "factor-reauth:" + createHash("sha256").update(owner.userId).digest("hex");
      const now = sql`floor(extract(epoch from statement_timestamp())*1000)::bigint`;
      const cutoff = sql`${now}-600000`;
      const [budget] = await tx.insert(authRateLimits).values({ id: randomUUID(), key, count: 1, lastRequest: now })
        .onConflictDoUpdate({ target: authRateLimits.key, set: {
          count: sql`case when ${authRateLimits.lastRequest}<${cutoff} then 1 else ${authRateLimits.count}+1 end`,
          lastRequest: sql`case when ${authRateLimits.lastRequest}<${cutoff} then ${now} else ${authRateLimits.lastRequest} end`,
        } }).returning();
      return { owner, limited: budget!.count > 10 };
    }).catch(nativeFailure);
    if (result.limited) throw new APIError("TOO_MANY_REQUESTS", {
      code: "REAUTHENTICATION_RATE_LIMITED", message: "Too many confirmation attempts; try again later",
    });
    return { ...result.owner, sessionId: session?.session.id, sessionToken: session?.session.token };
  }

  async function rotate(ctx: GenericEndpointContext, tx: Pick<Db, "execute">, owner: FactorSnapshot,
    version: number, proof: { authenticationMethod: string; authenticatedAt: Date }) {
    const [current] = await tx.execute<{ id: string }>(sql`select id from "user" where id=${owner.userId}
      and authenticator_version=${version}
      and not exists(select 1 from account_deletion_operations where user_id=${owner.userId}) for update nowait`);
    if (!current) deny();
    const user = await ctx.context.internalAdapter.findUserById(owner.userId);
    if (!user) deny();
    const previous = ctx.context.newSession;
    const dontRemember = !!await ctx.getSignedCookie(ctx.context.authCookies.dontRememberToken.name, ctx.context.secret);
    const session = await ctx.context.internalAdapter.createSession(owner.userId, dontRemember,
      { ...proof, authenticatorVersion: version }, true, { deferSecondaryStorageWrites: true });
    await setSessionCookie(ctx, { session, user }, dontRemember);
    if (previous?.user.id === owner.userId) await ctx.context.internalAdapter.deleteSession(previous.session.token);
    if (owner.sessionToken && owner.sessionToken !== previous?.session.token) {
      await ctx.context.internalAdapter.deleteSession(owner.sessionToken);
    }
    ctx.context.session = { session, user };
    return session;
  }

  function wrap(endpoint: NativeEndpoint, operation: Operation) {
    return createAuthEndpoint(endpoint.path, endpoint.options, async ctx => {
      const verification = operation === "totp" || operation === "backup_code";
      if (ctx.body && "trustDevice" in ctx.body && ctx.body.trustDevice === true) throw new APIError("BAD_REQUEST", {
        code: "TRUSTED_DEVICE_DISABLED", message: "Confirm your second factor at each sign-in",
      });
      if (operation === "backup_code" && "disableSession" in ctx.body && ctx.body.disableSession === true) {
        throw new APIError("BAD_REQUEST", { code: "SESSION_REQUIRED", message: "Complete the sign-in challenge" });
      }
      if (operation === "enable") {
        if ("method" in ctx.body && ctx.body.method !== "totp") throw new APIError("BAD_REQUEST", {
          code: "OTP_NOT_CONFIGURED", message: "Use an authenticator app",
        });
        Object.assign(ctx.body, { issuer: "Blentera" });
      }
      const owner = await snapshot(ctx, verification);
      if (!verification) return withNativeAuthenticationTransaction(db, ctx, schema, async tx => {
        const [current] = await tx.execute<{ id: string }>(sql`select id from "user" where id=${owner.userId}
          and authenticator_version=${owner.version} for update nowait`);
        if (!current || !owner.sessionId) deny();
        const proof = await assertHumanAuthentication(tx, { type: "board", source: "session",
          userId: owner.userId, sessionId: owner.sessionId }, { requireRecent: true,
          phishingResistant: operatorUserIds.includes(owner.userId) });
        if (operation === "enable" && (owner.enabled || owner.verified)) throw new APIError("CONFLICT", {
          code: "FACTOR_ALREADY_ENABLED", message: "Use your existing factor before replacing it",
        });
        const response = await invoke(ctx, endpoint);
        if (operation === "disable") {
          if (ctx.context.newSession) await ctx.context.internalAdapter.deleteSession(ctx.context.newSession.session.token);
          ctx.context.setNewSession(null);
          ctx.context.session = null;
          deleteSessionCookie(ctx);
        } else if (operation === "enable" || operation === "codes") {
          // Configuration keeps the real earlier event/time, rather than claiming
          // that issuing a cookie or new recovery codes was MFA verification.
          await rotate(ctx, tx, owner, owner.version + 1, {
            authenticationMethod: proof.method, authenticatedAt: proof.authenticatedAt,
          });
        }
        return response;
      }).catch(nativeFailure);

      if (!owner.factorId || !owner.secret || operation === "backup_code" && !owner.verified) deny();
      const factorSecret = owner.secret;
      try {
        // Keep native failed-attempt and one-use writes outside the completion
        // transaction: a rejected confirmation must not roll its budget back.
        const response = await invoke(ctx, endpoint);
        const version = owner.version + (operation === "backup_code" || !owner.verified && !owner.enabled ? 1 : 0);
        async function pinVerifiedFactor(tx: Pick<Db, "execute">) {
          const [valid] = await tx.execute<{ at: Date | string; secret: string }>(sql`select clock_timestamp() as at,f.secret
            from "user" u join two_factor f on f.user_id=u.id
            where u.id=${owner.userId} and u.authenticator_version=${version} and u.two_factor_enabled
              and f.id=${owner.factorId} and f.verified
              and not exists(select 1 from account_deletion_operations where user_id=u.id)
              and ${operation === "totp" && owner.verified && owner.sessionId ? sql`exists(select 1 from "session" s
                where s.id=${owner.sessionId} and s.user_id=u.id and s.expires_at>clock_timestamp())` : sql`true`}
              for update of u nowait`);
          if (!valid || valid.secret !== owner.secret) deny();
          return valid;
        }
        let verifiedAt: Date | null = null;
        if (operation === "totp") {
          // Consumption commits independently: a later session/cookie failure
          // cannot make an already verified code usable again.
          verifiedAt = await db.transaction(async tx => {
            const valid = await pinVerifiedFactor(tx);
            // The provider has verified this value. Consume its fingerprint in
            // the same physical transaction as proof/session publication. Keep
            // it across password and backup-code changes to prevent reuse there.
            const code = "code" in ctx.body ? ctx.body.code : deny();
            const fingerprint = createHmac("sha256", factorSecret).update(code).digest("hex");
            const now = sql`floor(extract(epoch from statement_timestamp())*1000)::bigint`;
            const [consumed] = await tx.execute<{ id: string }>(sql`
              update two_factor set totp_replay_state=coalesce((
                select jsonb_agg(receipt) from jsonb_array_elements(totp_replay_state) receipt
                where (receipt->>'expiresAtMs')::bigint>${now}
              ),'[]'::jsonb)||jsonb_build_array(jsonb_build_object(
                'fingerprint',${fingerprint}::text,'expiresAtMs',${now}+90000))
              where id=${owner.factorId} and not exists (
                select 1 from jsonb_array_elements(totp_replay_state) receipt
                where receipt->>'fingerprint'=${fingerprint} and (receipt->>'expiresAtMs')::bigint>${now})
              returning id
            `);
            if (!consumed) throw new APIError("UNAUTHORIZED", {
              code: "OTP_ALREADY_USED", message: "Wait for a new authenticator code or use a recovery code",
            });
            return new Date(valid.at);
          });
        }
        const session = await withNativeAuthenticationTransaction(db, ctx, schema, async tx => {
          const valid = await pinVerifiedFactor(tx);
          return rotate(ctx, tx, owner, version, { authenticationMethod: operation,
            authenticatedAt: verifiedAt ?? new Date(valid.at) });
        });
        return { ...response, token: session.token, user: parseUserOutput(ctx.context.options, ctx.context.session!.user) };
      } catch (error) {
        const created = ctx.context.newSession;
        if (created?.user.id === owner.userId) {
          await ctx.context.internalAdapter.deleteSession(created.session.token);
          ctx.context.setNewSession(null);
          deleteSessionCookie(ctx);
        }
        nativeFailure(error);
      }
    });
  }

  const originalHook = native.hooks.after[0];
  return { ...native, endpoints: {
    // Email/SMS OTP delivery is not configured. Retain only the supported
    // verifier paths and the maintained server-only utilities.
    generateTOTP: native.endpoints.generateTOTP,
    viewBackupCodes: native.endpoints.viewBackupCodes,
    changePassword: createAuthEndpoint(nativeChangePassword.path, nativeChangePassword.options, async ctx => {
      const active = ctx.context.session;
      return withNativeAuthenticationTransaction(db, ctx, schema, async tx => {
        const [current] = await tx.execute<FactorSnapshot>(sql`select u.id as "userId",
          u.authenticator_version as version,u.two_factor_enabled as enabled,
          u.phishing_resistant_required as "phishingResistantRequired"
          from "user" u join "session" s on s.user_id=u.id
          where u.id=${active.user.id} and s.id=${active.session.id} and s.expires_at>clock_timestamp()
            and not exists(select 1 from account_deletion_operations where user_id=u.id)
          for update of u,s nowait`);
        if (!current) deny();
        const strong = current.enabled || current.phishingResistantRequired || operatorUserIds.includes(current.userId);
        const proof = strong ? await assertHumanAuthentication(tx, { type: "board", source: "session",
          userId: current.userId, sessionId: active.session.id }, { requireRecent: true,
          phishingResistant: operatorUserIds.includes(current.userId) }) : null;
        const response = await invoke(ctx, nativeChangePassword);
        const [clock] = await tx.execute<{ at: Date | string }>(sql`select clock_timestamp() as at`);
        const session = await rotate(ctx, tx, { ...current, sessionToken: active.session.token }, current.version+1, {
          authenticationMethod: proof?.method ?? "password", authenticatedAt: proof?.authenticatedAt ?? new Date(clock!.at),
        });
        return { ...response, token: session.token, user: parseUserOutput(ctx.context.options, ctx.context.session!.user) };
      }).catch(nativeFailure);
    }),
    enableTwoFactor: wrap(native.endpoints.enableTwoFactor, "enable"),
    disableTwoFactor: wrap(native.endpoints.disableTwoFactor, "disable"),
    generateBackupCodes: wrap(native.endpoints.generateBackupCodes, "codes"),
    getTOTPURI: wrap(native.endpoints.getTOTPURI, "uri"),
    verifyTOTP: wrap(native.endpoints.verifyTOTP, "totp"),
    verifyBackupCode: wrap(native.endpoints.verifyBackupCode, "backup_code"),
  }, hooks: { ...native.hooks, after: [{ ...originalHook, handler: createAuthMiddleware(async ctx => {
    const created = ctx.context.newSession;
    if (!created?.user.twoFactorEnabled) return;
    const version: unknown = created.user.authenticatorVersion;
    try {
      if (typeof version !== "number" || !Number.isSafeInteger(version)) deny();
      return await withNativeAuthenticationTransaction(db, ctx, schema, async tx => {
        const [current] = await tx.execute<{ id: string }>(sql`select id from "user" where id=${created.user.id}
          and authenticator_version=${version} and two_factor_enabled
          and not exists(select 1 from account_deletion_operations where user_id=${created.user.id}) for update nowait`);
        if (!current) deny();
        // Historic/restored trusted-device cookies cannot bypass an actual factor.
        const trust = ctx.context.createAuthCookie("trust_device");
        const headers = new Headers(ctx.headers);
        headers.set("cookie", (headers.get("cookie") ?? "").split(";")
          .filter(part => part.trim().split("=", 1)[0] !== trust.name).join(";"));
        expireCookie(ctx, trust);
        const result = await originalHook.handler({ ...ctx, headers, asResponse: false, returnHeaders: true }) as unknown as NativeResponse;
        for (const [key, value] of result.headers) if (key.toLowerCase() !== "set-cookie") ctx.setHeader(key, value);
        for (const cookie of result.headers.getSetCookie()) ctx.responseHeaders.append("set-cookie", cookie);
        return result.response;
      });
    } catch (error) {
      deleteSessionCookie(ctx);
      ctx.context.setNewSession(null);
      await ctx.context.internalAdapter.deleteSession(created.session.token);
      nativeFailure(error);
    }
  }) }] } };
}
