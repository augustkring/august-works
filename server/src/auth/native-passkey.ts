import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { APIError, type GenericEndpointContext, type BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint, getSessionFromCtx } from "better-auth/api";
import { deleteSessionCookie, setSessionCookie } from "better-auth/cookies";
import { passkey } from "@better-auth/passkey";
import { authPasskeys, authRateLimits, type Db } from "@paperclipai/db";
import { nativePasskeySchema } from "@paperclipai/shared";
import { assertHumanAuthentication, assertPinnedAuthenticationDeadline, isAuthenticationStateBusy } from "./authenticator-assurance.js";
import { assertExpectedAuthenticationSession, assertExpectedAuthenticationUser,
  withNativeAuthenticationTransaction, type NativeAuthenticationSchema } from "./native-authentication-transaction.js";

function deny(): never {
  throw new APIError("UNAUTHORIZED", { code: "PASSKEY_CONFIRMATION_REQUIRED", message: "Confirm your identity with a passkey" });
}
function failure(error: unknown): never {
  if (isAuthenticationStateBusy(error) || error && typeof error === "object" && "status" in error && error.status === 409) {
    throw new APIError("CONFLICT", { code: "AUTHENTICATION_STATE_CHANGED", message: "Sign-in changed; try again" });
  }
  if (error && typeof error === "object" && "status" in error && error.status === 403) deny();
  throw error;
}
type Owner = { userId: string; version: number; sessionId?: string; sessionToken?: string };
type Ceremony = { userId: string; credentialId?: string; operation: "registration" | "authentication"; verified: boolean };
type NativeEndpoint = ReturnType<typeof passkey>["endpoints"][keyof ReturnType<typeof passkey>["endpoints"]];
type NativeResponse = { headers: Headers; response: Record<string, unknown>; status: Parameters<GenericEndpointContext["setStatus"]>[0] };

/** The canonical configured origin/RP and the maintained verifier own the
 * ceremony. Request headers/browser context never select either identity. */
export function nativePasskeyPlugin(db: Db, schema: NativeAuthenticationSchema, origin: string, operatorUserIds: readonly string[]): BetterAuthPlugin {
  const ceremonies = new AsyncLocalStorage<Ceremony>();
  const native = passkey({ rpName: "Blentera", rpID: new URL(origin).hostname, origin,
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    registration: { requireSession: true, afterVerification: async ({ verification, user }) => {
      const state = ceremonies.getStore();
      if (!state || state.operation !== "registration" || state.userId !== user.id ||
        verification.registrationInfo?.userVerified !== true) deny();
      state.verified = true;
    } },
    authentication: { afterVerification: async ({ verification, clientData }) => {
      const state = ceremonies.getStore();
      if (!state || state.operation !== "authentication" || state.credentialId !== clientData.id ||
        verification.authenticationInfo.userVerified !== true) deny();
      state.verified = true;
    } },
  });
  async function invoke(ctx: GenericEndpointContext, endpoint: NativeEndpoint) {
    const call = endpoint as unknown as (input: GenericEndpointContext & {
      asResponse: false; returnHeaders: true; returnStatus: true;
    }) => Promise<NativeResponse>;
    const result = await call({ ...ctx, asResponse: false, returnHeaders: true, returnStatus: true });
    for (const [key, value] of result.headers) if (key.toLowerCase() !== "set-cookie") ctx.setHeader(key, value);
    for (const cookie of result.headers.getSetCookie()) ctx.responseHeaders.append("set-cookie", cookie);
    ctx.setStatus(result.status);
    return result.response;
  }
  async function owner(ctx: GenericEndpointContext): Promise<Owner> {
    const active = await getSessionFromCtx(ctx);
    if (!active) deny();
    assertExpectedAuthenticationUser(ctx, active.user.id);
    assertExpectedAuthenticationSession(ctx, active.session.id);
    const [current] = await db.execute<{ version: number }>(sql`select u.authenticator_version as version
      from "user" u join "session" s on s.user_id=u.id where u.id=${active.user.id}
      and s.id=${active.session.id} and s.expires_at>clock_timestamp()
      and not exists(select 1 from account_deletion_operations where user_id=u.id)`);
    if (!current) deny();
    return { userId: active.user.id, version: current.version, sessionId: active.session.id, sessionToken: active.session.token };
  }
  async function pin(tx: Pick<Db, "execute">, source: Owner, ctx: GenericEndpointContext, exclusive = true) {
    const [current] = await tx.execute<{ id: string }>(sql`select id from "user" where id=${source.userId}
      and authenticator_version=${source.version}
      and not exists(select 1 from account_deletion_operations where user_id=${source.userId})
      and (not ${ctx.context.options.emailAndPassword?.requireEmailVerification === true}::boolean or email_verified)
      and not exists(select 1 from enterprise_subject_bindings b where b.user_id=${source.userId} and b.status='active') ${exclusive ? sql`for update nowait` : sql`for share nowait`}`);
    if (!current) deny();
    if (source.sessionId) {
      const [active] = await tx.execute(sql`select id from "session" where id=${source.sessionId}
        and user_id=${source.userId} and expires_at>clock_timestamp() for share nowait`);
      if (!active) deny();
    }
  }
  function recent(tx: Pick<Db, "execute">, source: Owner) {
    return assertHumanAuthentication(tx, { type: "board", source: "session", userId: source.userId,
      sessionId: source.sessionId }, { requireRecent: true, phishingResistant: operatorUserIds.includes(source.userId) });
  }
  async function challenge(ctx: GenericEndpointContext, operation: Ceremony["operation"]) {
    const cookie = ctx.context.createAuthCookie("better-auth-passkey");
    const nonce = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
    if (!nonce) deny();
    const found = await ctx.context.internalAdapter.findVerificationValue(nonce);
    if (!found) deny();
    const [row] = await db.execute<{ value: string; version: number | null }>(sql`
      select value,authenticator_version as version from verification
      where id=${found.id} and expires_at>clock_timestamp()`);
    if (!row) deny();
    try {
      const data: unknown = JSON.parse(row.value);
      if (!data || typeof data !== "object" || !("type" in data) || data.type !== operation ||
        !("userData" in data) || !data.userData || typeof data.userData !== "object" ||
        !("id" in data.userData) || typeof data.userData.id !== "string") deny();
      return { nonce, id: found.id, value: row.value, userId: data.userData.id, version: row.version,
        context: "context" in data ? data.context : null };
    } catch { await consumeAfterRejection(ctx, nonce); deny(); }
  }
  async function consumeAfterRejection(ctx: GenericEndpointContext, nonce: string) {
    // Native consumption inside a rolled-back protected mutation must not make
    // the signed provider challenge reusable. Keep the provider's atomic owner.
    await ctx.context.internalAdapter.consumeVerificationValue(nonce);
  }
  async function withConsumedChallenge<T>(ctx: GenericEndpointContext, pending: Awaited<ReturnType<typeof challenge>>, execute: () => Promise<T>) {
    const original = ctx.context.internalAdapter;
    // Commit the maintained atomic consume before the protected mutation. A
    // rollback/crash cannot reopen a gap in which another request reuses it.
    const consumed = await original.consumeVerificationValue(pending.nonce);
    if (!consumed || consumed.id !== pending.id || consumed.value !== pending.value) deny();
    let available = true;
    ctx.context.internalAdapter = { ...original, consumeVerificationValue: async identifier => {
      if (identifier !== pending.nonce) return original.consumeVerificationValue(identifier);
      if (!available) return null;
      available = false;
      return consumed;
    } };
    try { return await execute(); }
    finally { ctx.context.internalAdapter = original; }
  }
  async function replacement(ctx: GenericEndpointContext, source: Owner, version: number,
    proof: { authenticationMethod: string; authenticatedAt: Date }) {
    const user = await ctx.context.internalAdapter.findUserById(source.userId);
    if (!user) deny();
    const previous = ctx.context.newSession;
    const dontRemember = !!await ctx.getSignedCookie(ctx.context.authCookies.dontRememberToken.name, ctx.context.secret);
    const session = await ctx.context.internalAdapter.createSession(source.userId, dontRemember,
      { ...proof, authenticatorVersion: version }, true, { deferSecondaryStorageWrites: true });
    await setSessionCookie(ctx, { session, user }, dontRemember);
    if (previous?.user.id === source.userId) await ctx.context.internalAdapter.deleteSession(previous.session.token);
    if (source.sessionToken && source.sessionToken !== previous?.session.token) {
      await ctx.context.internalAdapter.deleteSession(source.sessionToken);
    }
    ctx.context.session = { session, user };
    return session;
  }
  function passkeySummary(value: Record<string, unknown>) {
    return nativePasskeySchema.parse({ id: value.id, name: value.name ?? null,
      createdAt: value.createdAt instanceof Date ? value.createdAt.toISOString() : value.createdAt });
  }
  return { ...native, endpoints: {
    generatePasskeyRegistrationOptions: createAuthEndpoint(native.endpoints.generatePasskeyRegistrationOptions.path,
      native.endpoints.generatePasskeyRegistrationOptions.options, async ctx => {
        const source = await owner(ctx);
        return withNativeAuthenticationTransaction(db, ctx, schema, async tx => {
          await pin(tx, source, ctx); const proof = await recent(tx, source);
          const [{ count }] = await tx.execute<{ count: number }>(sql`select count(*)::integer as count from passkey where user_id=${source.userId}`);
          if (count >= 16) throw new APIError("BAD_REQUEST", { code: "PASSKEY_LIMIT", message: "Remove an unused passkey first" });
          ctx.query = { ...ctx.query, name: undefined, context: JSON.stringify({ sessionId: source.sessionId, version: source.version }) };
          ctx.setHeader("Cache-Control", "no-store");
          const response = await invoke(ctx, native.endpoints.generatePasskeyRegistrationOptions);
          await assertPinnedAuthenticationDeadline(tx, proof);
          return response;
        }).catch(failure);
      }),
    verifyPasskeyRegistration: createAuthEndpoint(native.endpoints.verifyPasskeyRegistration.path,
      native.endpoints.verifyPasskeyRegistration.options, async ctx => {
        const source = await owner(ctx), pending = await challenge(ctx, "registration");
        try {
          if (pending.userId !== source.userId || pending.version !== source.version ||
            pending.context !== JSON.stringify({ sessionId: source.sessionId, version: source.version }) || ctx.body.createSession) deny();
          if (ctx.body.name && (typeof ctx.body.name !== "string" || ctx.body.name.length > 120)) deny();
          return await withConsumedChallenge(ctx, pending, () => withNativeAuthenticationTransaction(db, ctx, schema, async tx => {
            await pin(tx, source, ctx); const proof = await recent(tx, source);
            const [{ count }] = await tx.execute<{ count: number }>(sql`select count(*)::integer as count from passkey where user_id=${source.userId}`);
            if (count>=16) throw new APIError("BAD_REQUEST", { code: "PASSKEY_LIMIT", message: "Remove an unused passkey first" });
            const state: Ceremony = { userId: source.userId, operation: "registration", verified: false };
            const result = await ceremonies.run(state, () => invoke(ctx, native.endpoints.verifyPasskeyRegistration));
            if (!state.verified) deny();
            const [current] = await tx.execute(sql`select id from "user" where id=${source.userId} and authenticator_version=${source.version+1}`);
            if (!current) deny();
            const session = await replacement(ctx, source, source.version+1, { authenticationMethod: proof.method, authenticatedAt: proof.authenticatedAt });
            await assertPinnedAuthenticationDeadline(tx, proof);
            return { ...passkeySummary(result), sessionId: session.id };
          }));
        } catch (error) { await consumeAfterRejection(ctx, pending.nonce); return failure(error); }
      }),
    generatePasskeyAuthenticationOptions: createAuthEndpoint(native.endpoints.generatePasskeyAuthenticationOptions.path,
      native.endpoints.generatePasskeyAuthenticationOptions.options, async ctx => {
        const active = await getSessionFromCtx(ctx);
        if (active) { assertExpectedAuthenticationUser(ctx, active.user.id); assertExpectedAuthenticationSession(ctx, active.session.id); }
        else if (ctx.getHeader("X-Blentera-Expected-User") !== null || ctx.getHeader("X-Blentera-Expected-Session") !== null) deny();
        ctx.setHeader("Cache-Control", "no-store");
        return { ...await invoke(ctx, native.endpoints.generatePasskeyAuthenticationOptions).catch(failure), userVerification: "required" };
      }),
    verifyPasskeyAuthentication: createAuthEndpoint(native.endpoints.verifyPasskeyAuthentication.path,
      native.endpoints.verifyPasskeyAuthentication.options, async ctx => {
        const pending = await challenge(ctx, "authentication");
        try {
          const credentialId: unknown = ctx.body.response?.id;
          if (typeof credentialId !== "string" || !credentialId.length || credentialId.length>2048) deny();
          const active = await getSessionFromCtx(ctx);
          const captured = await db.transaction(async tx => {
            const [source] = await tx.execute<Owner>(sql`select u.id as "userId",u.authenticator_version as version
              from "user" u join passkey p on p.user_id=u.id where p.credential_id=${credentialId}
              and not exists(select 1 from account_deletion_operations where user_id=u.id)
              and (not ${ctx.context.options.emailAndPassword?.requireEmailVerification === true}::boolean or u.email_verified)
              and not exists(select 1 from enterprise_subject_bindings b where b.user_id=u.id and b.status='active') for share of u nowait`);
            if (!source || pending.userId && (pending.userId !== source.userId || pending.version !== source.version) ||
              active && active.user.id !== source.userId) deny();
            assertExpectedAuthenticationUser(ctx, source.userId);
            assertExpectedAuthenticationSession(ctx, active?.session.id);
            if (active) {
              const [session] = await tx.execute(sql`select id from "session" where id=${active.session.id}
                and user_id=${source.userId} and expires_at>clock_timestamp() for share nowait`);
              if (!session) deny();
            }
            const key = "passkey-auth:"+createHash("sha256").update(source.userId).digest("hex");
            const now = sql`floor(extract(epoch from statement_timestamp())*1000)::bigint`, cutoff = sql`${now}-600000`;
            const [budget] = await tx.insert(authRateLimits).values({ id: randomUUID(), key, count: 1, lastRequest: now })
              .onConflictDoUpdate({ target: authRateLimits.key, set: {
                count: sql`case when ${authRateLimits.lastRequest}<${cutoff} then 1 else ${authRateLimits.count}+1 end`,
                lastRequest: sql`case when ${authRateLimits.lastRequest}<${cutoff} then ${now} else ${authRateLimits.lastRequest} end`,
              } }).returning();
            return { source, limited: budget.count>10 };
          });
          if (captured.limited) throw new APIError("TOO_MANY_REQUESTS", { code: "REAUTHENTICATION_RATE_LIMITED", message: "Too many confirmation attempts; try again later" });
          const source = { ...captured.source, sessionId: active?.session.id, sessionToken: active?.session.token };
          return await withConsumedChallenge(ctx, pending, () => withNativeAuthenticationTransaction(db, ctx, schema, async tx => {
            await pin(tx, source, ctx);
            const [key] = await tx.execute(sql`select id from passkey where user_id=${source.userId} and credential_id=${credentialId} for update nowait`);
            if (!key) deny();
            const state: Ceremony = { userId: source.userId, credentialId, operation: "authentication", verified: false };
            await ceremonies.run(state, () => invoke(ctx, native.endpoints.verifyPasskeyAuthentication));
            if (!state.verified) deny();
            if (operatorUserIds.includes(source.userId)) await tx.execute(sql`update "user" set phishing_resistant_required=true where id=${source.userId}`);
            const [{ at }] = await tx.execute<{ at: string }>(sql`select clock_timestamp() as at`);
            const session = await replacement(ctx, source, source.version, { authenticationMethod: "passkey", authenticatedAt: new Date(at) });
            return { userId: source.userId, sessionId: session.id };
          }));
        } catch (error) { await consumeAfterRejection(ctx, pending.nonce); return failure(error); }
      }),
    listPasskeys: createAuthEndpoint(native.endpoints.listPasskeys.path, native.endpoints.listPasskeys.options, async ctx => {
      const source = await owner(ctx);
      return withNativeAuthenticationTransaction(db, ctx, schema, async tx => {
        await pin(tx, source, ctx, false);
        const rows = await tx.select({ id: authPasskeys.id, name: authPasskeys.name, createdAt: authPasskeys.createdAt })
          .from(authPasskeys).where(eq(authPasskeys.userId, source.userId))
          .orderBy(authPasskeys.createdAt, authPasskeys.id).limit(17);
        if (rows.length>16) deny();
        ctx.setHeader("Cache-Control", "no-store");
        return rows.map(row => passkeySummary(row));
      }).catch(failure);
    }),
    ...Object.fromEntries((["deletePasskey", "updatePasskey"] as const).map(operation => {
      const endpoint = native.endpoints[operation];
      return [operation, createAuthEndpoint(endpoint.path, endpoint.options, async ctx => {
        const source = await owner(ctx);
        return withNativeAuthenticationTransaction(db, ctx, schema, async tx => {
          await pin(tx, source, ctx); const proof = await recent(tx, source);
          const [key] = await tx.execute(sql`select id from passkey where id=${ctx.body.id} and user_id=${source.userId} for update nowait`);
          if (!key || "name" in ctx.body && (typeof ctx.body.name !== "string" || ctx.body.name.length>120)) deny();
          if (operation === "deletePasskey") {
            const [retained] = await tx.execute<{ allowed: boolean }>(sql`select
              (not u.phishing_resistant_required and exists(select 1 from account a where a.user_id=u.id and a.provider_id='credential' and a.password is not null))
              or exists(select 1 from passkey p where p.user_id=u.id and p.id<>${ctx.body.id}) as allowed from "user" u where u.id=${source.userId}`);
            if (!retained?.allowed) throw new APIError("CONFLICT", { code: "PASSKEY_REQUIRED", message: "Add a replacement passkey before removing this one" });
          }
          const result = await invoke(ctx, endpoint);
          await assertPinnedAuthenticationDeadline(tx, proof);
          if (operation === "deletePasskey") { ctx.context.setNewSession(null); (ctx as GenericEndpointContext).context.session=null; deleteSessionCookie(ctx); return { status: true }; }
          return { passkey: passkeySummary(result.passkey as Record<string, unknown>) };
        }).catch(failure);
      })];
    })),
  } };
}
