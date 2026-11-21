import { APIError, type GenericEndpointContext } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getCurrentDBAdapterAsyncLocalStorage } from "@better-auth/core/context";
import type { Db } from "@paperclipai/db";

export type NativeAuthenticationSchema = NonNullable<Parameters<typeof drizzleAdapter>[1]["schema"]>;
type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** A browser intent may narrow the actual cookie principal, never choose it.
 * Native SDK calls without this optional precondition retain their own-user API. */
export function assertExpectedAuthenticationUser(ctx: GenericEndpointContext, userId: string) {
  const expected = ctx.getHeader("X-Blentera-Expected-User");
  if (expected !== null && expected !== userId) throw new APIError("CONFLICT", {
    code: "ACCOUNT_CHANGED", message: "Account changed; reload this page",
  });
}

export function assertExpectedAuthenticationSession(ctx: GenericEndpointContext, sessionId: string | undefined) {
  const expected = ctx.getHeader("X-Blentera-Expected-Session");
  if (expected !== null && expected !== sessionId) throw new APIError("CONFLICT", {
    code: "AUTHENTICATION_STATE_CHANGED", message: "Sign-in changed; confirm the current account again",
  });
}

/** Bind the maintained provider to the same physical transaction as its proof
 * check. Native after-commit hooks and cookie publication follow the real commit. */
export async function withNativeAuthenticationTransaction<T>(
  db: Db,
  ctx: GenericEndpointContext,
  schema: NativeAuthenticationSchema,
  execute: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const storage = await getCurrentDBAdapterAsyncLocalStorage();
  const pendingHooks: Array<() => Promise<void>> = [];
  const originalAdapter = ctx.context.adapter;
  const originalSession = ctx.context.session;
  const originalNewSession = ctx.context.newSession;
  const originalCookies = ctx.responseHeaders.getSetCookie();
  let result: T;
  try {
    result = await db.transaction(async tx => {
      const adapter = drizzleAdapter(tx, { provider: "pg", schema, transaction: false })(ctx.context.options);
      return storage.run({ adapter, pendingHooks, isTransactionActive: true }, async () => {
        ctx.context.adapter = adapter;
        try { return await execute(tx); }
        finally { ctx.context.adapter = originalAdapter; }
      });
    });
  } catch (error) {
    ctx.context.session = originalSession;
    ctx.context.setNewSession(originalNewSession);
    ctx.responseHeaders.delete("set-cookie");
    for (const cookie of originalCookies) ctx.responseHeaders.append("set-cookie", cookie);
    throw error;
  }
  for (const hook of pendingHooks) await hook();
  return result;
}
