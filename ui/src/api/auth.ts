import {
  authSessionSchema,
  nativeAuthenticationSecuritySchema,
  nativeAuthenticationMethodsSchema,
  nativePasskeyListSchema,
  nativePasskeyRegistrationSchema,
  nativePasskeyAuthenticationSchema,
  nativeAuthenticationConfirmationSchema,
  nativeRecoveryCodesSchema,
  nativeTotpEnrollmentSchema,
  type NativeAuthenticationSecurity,
  currentUserPreferencesSchema,
  type CurrentUserPreferences,
  type UpdateCurrentUserPreferences,
  currentUserProfileSchema,
  type AuthSession,
  type CurrentUserProfile,
  type UpdateCurrentUserProfile,
} from "@paperclipai/shared";
import { createAuthClient } from "better-auth/client";
import { passkeyClient } from "@better-auth/passkey/client";
import { tenantSessionRecovery } from "@/lib/tenant-session-recovery";
import { i18n } from "@/i18n";

type AuthErrorBody =
  | {
    code?: string;
    message?: string;
    error?: string | { code?: string; message?: string };
  }
  | null;

export interface SignOutResult {
  success?: boolean;
  redirectTo?: string;
}

export interface TwoFactorSignInChallenge {
  userId: string;
  twoFactorRedirect: true;
  twoFactorMethods: string[];
}

export function parseTwoFactorSignInChallenge(value: unknown): TwoFactorSignInChallenge | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (payload.twoFactorRedirect !== true) return null;
  if (typeof payload.userId !== "string" || !payload.userId || !Array.isArray(payload.twoFactorMethods) || payload.twoFactorMethods.length === 0 ||
      !payload.twoFactorMethods.every((method) => typeof method === "string")) {
    throw new Error("Invalid native two-factor challenge response");
  }
  return { userId: payload.userId, twoFactorRedirect: true, twoFactorMethods: payload.twoFactorMethods };
}

export class AuthApiError extends Error {
  status: number;
  code: string | null;
  body: unknown;

  constructor(message: string, status: number, body: unknown, code: string | null = null) {
    super(message);
    this.name = "AuthApiError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

function toSession(value: unknown): AuthSession | null {
  const direct = authSessionSchema.safeParse(value);
  if (direct.success) return direct.data;

  if (!value || typeof value !== "object") return null;
  const nested = authSessionSchema.safeParse((value as Record<string, unknown>).data);
  return nested.success ? nested.data : null;
}

function extractAuthError(payload: AuthErrorBody, status: number) {
  const nested =
    payload?.error && typeof payload.error === "object"
      ? payload.error
      : null;
  const code =
    typeof nested?.code === "string"
      ? nested.code
      : typeof payload?.code === "string"
        ? payload.code
        : null;
  const message =
    typeof nested?.message === "string" && nested.message.trim().length > 0
      ? nested.message
      : typeof payload?.message === "string" && payload.message.trim().length > 0
        ? payload.message
        : typeof payload?.error === "string" && payload.error.trim().length > 0
          ? payload.error
          : `Request failed: ${status}`;

  return new AuthApiError(message, status, payload, code);
}

// Rich diagnostics for auth requests. Network-layer failures (Safari
// "Load failed" / Chrome "Failed to fetch") throw a TypeError *before* any
// HTTP response, so they are indistinguishable from a bad password in the UI
// unless we log the resolved request URL + origin here. See PAP-13466.
function resolveAuthUrl(path: string) {
  const relative = `/api/auth${path}`;
  try {
    return new URL(relative, window.location.origin).href;
  } catch {
    return relative;
  }
}

function logAuthNetworkFailure(method: string, path: string) {
  // eslint-disable-next-line no-console
  console.error("[auth] request failed at the network layer (no HTTP response)", {
    method,
    requestUrl: resolveAuthUrl(path),
    pageOrigin: typeof window !== "undefined" ? window.location.origin : "(no window)",
    credentials: "include",
    online: typeof navigator !== "undefined" ? navigator.onLine : "(no navigator)",
    hint:
      "This means the browser never got a response from the server. Common causes: " +
      "the page origin differs from the API host (mixed http/https, wrong hostname/port, " +
      "or a proxy/tunnel that only forwards the page but not /api), an SSL error, or the " +
      "connection was reset. A wrong password would instead return HTTP 401, not this.",
  });
}

function logAuthHttpError(method: string, path: string, status: number) {
  // eslint-disable-next-line no-console
  console.error("[auth] request returned an error status", {
    method,
    requestUrl: resolveAuthUrl(path),
    status,
  });
}

async function authPost(path: string, body: Record<string, unknown>, expectedUserId?: string, expectedSessionId?: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`/api/auth${path}`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-Blentera-Locale": i18n.resolvedLanguage === "da" ? "da" : "en",
        ...(expectedUserId ? { "X-Blentera-Expected-User": expectedUserId } : {}),
        ...(expectedSessionId ? { "X-Blentera-Expected-Session": expectedSessionId } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch (networkError) {
    logAuthNetworkFailure("POST", path);
    throw networkError;
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const recovery = tenantSessionRecovery.recoverIfNeeded(res.status, payload);
    if (recovery) return recovery;
    logAuthHttpError("POST", path, res.status);
    throw extractAuthError(payload as AuthErrorBody, res.status);
  }
  return payload;
}

async function authPatch<T>(path: string, body: Record<string, unknown>, parse: (value: unknown) => T): Promise<T> {
  const res = await fetch(`/api/auth${path}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const recovery = tenantSessionRecovery.recoverIfNeeded(res.status, payload);
    if (recovery) return recovery;
    throw extractAuthError(payload as AuthErrorBody, res.status);
  }
  return parse(payload);
}

function nativePasskeys(expectedUserId?: string, expectedSessionId?: string) {
  return createAuthClient({ baseURL: window.location.origin, plugins: [passkeyClient()], fetchOptions: {
    credentials: "include", jsonParser: JSON.parse,
    onRequest(context) {
      const url = new URL(context.url);
      // The SDK repeats this private label in its options GET; the maintained
      // verification POST already carries it, so keep it out of request URLs.
      if (url.pathname === "/api/auth/passkey/generate-register-options") {
        url.searchParams.delete("name"); return { ...context, url };
      }
    },
    headers: {
      "X-Blentera-Locale": i18n.resolvedLanguage === "da" ? "da" : "en",
      ...(expectedUserId ? { "X-Blentera-Expected-User": expectedUserId } : {}),
      ...(expectedSessionId ? { "X-Blentera-Expected-Session": expectedSessionId } : {}),
    },
  } });
}
function passkeyResult(result: { data: unknown; error: { code?: string; message?: string; status?: number } | null }) {
  if (result.error) throw new AuthApiError(result.error.message ?? "Passkey confirmation failed", result.error.status ?? 400, null, result.error.code ?? null);
  return result.data;
}

export const authApi = {
  authenticationMethods: async (signal?: AbortSignal) => {
    const response = await fetch("/api/auth/methods", { cache: "no-store", credentials: "include", signal });
    if (!response.ok) throw new Error("Sign-in methods could not be loaded");
    return nativeAuthenticationMethodsSchema.parse(await response.json());
  },
  authenticatePasskey: async (expectedUserId?: string, expectedSessionId?: string) =>
    nativePasskeyAuthenticationSchema.parse(passkeyResult(await nativePasskeys(expectedUserId, expectedSessionId).signIn.passkey())),
  addPasskey: async (name: string, expectedUserId: string, expectedSessionId: string) =>
    nativePasskeyRegistrationSchema.parse(passkeyResult(await nativePasskeys(expectedUserId, expectedSessionId).passkey.addPasskey({ name }))),
  listPasskeys: async (expectedUserId: string, expectedSessionId: string, signal?: AbortSignal) => {
    const response = await fetch("/api/auth/passkey/list-user-passkeys", { credentials: "include", cache: "no-store", signal,
      headers: { "X-Blentera-Expected-User": expectedUserId, "X-Blentera-Expected-Session": expectedSessionId } });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw extractAuthError(payload, response.status);
    return nativePasskeyListSchema.parse(payload);
  },
  renamePasskey: async (id: string, name: string, expectedUserId: string, expectedSessionId: string) =>
    authPost("/passkey/update-passkey", { id, name }, expectedUserId, expectedSessionId),
  deletePasskey: async (id: string, expectedUserId: string, expectedSessionId: string) =>
    authPost("/passkey/delete-passkey", { id }, expectedUserId, expectedSessionId),

  getSession: async (): Promise<AuthSession | null> => {
    const res = await fetch("/api/auth/get-session", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      const recovery = tenantSessionRecovery.recoverIfNeeded(res.status, payload);
      if (recovery) return recovery;
      if (res.status === 401) return null;
      throw new Error(`Failed to load session (${res.status})`);
    }
    const direct = toSession(payload);
    if (direct) return direct;
    const nested = payload && typeof payload === "object" ? toSession((payload as Record<string, unknown>).data) : null;
    return nested;
  },

  signInSso: async (email: string, nextPath: string, providerId?: string) => {
    if (!/^\/(?!\/)/.test(nextPath) || /[\\\r\n]/.test(nextPath)) throw new Error("Invalid sign-in destination");
    const payload = await authPost("/sign-in/sso", {email:email.trim(),...(providerId ? {providerId} : {}),callbackURL:new URL(nextPath,window.location.origin).href}) as {url?:unknown};
    if (typeof payload?.url!=="string") throw new Error("Identity provider redirect unavailable");
    const target=new URL(payload.url);
    if(target.protocol!=="https:" || target.username || target.password) throw new Error("Invalid identity provider redirect");
    return target.href;
  },
  signInEmail: async (input: { email: string; password: string }): Promise<TwoFactorSignInChallenge | null> => {
    return parseTwoFactorSignInChallenge(await authPost("/sign-in/email", input));
  },

  verifyTotp: async (code: string, expectedUserId?: string, expectedSessionId?: string) =>
    nativeAuthenticationConfirmationSchema.parse(await authPost("/two-factor/verify-totp", { code }, expectedUserId, expectedSessionId)),

  reauthenticatePassword: async (password: string, expectedUserId?: string, expectedSessionId?: string) =>
    nativeAuthenticationConfirmationSchema.parse(await authPost("/reauthenticate/password", { password }, expectedUserId, expectedSessionId)),

  accountDeletionSsoStatus: async (expectedUserId: string, expectedSessionId: string) => {
    const response = await fetch("/api/auth/account-deletion/sso/status", { credentials: "include", cache: "no-store",
      headers: { Accept: "application/json", "X-Blentera-Expected-User": expectedUserId,
        "X-Blentera-Expected-Session": expectedSessionId } });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw extractAuthError(payload as AuthErrorBody, response.status);
    if (!payload || typeof payload !== "object" || (payload as Record<string, unknown>).userId !== expectedUserId ||
      typeof (payload as Record<string, unknown>).available !== "boolean" ||
      typeof (payload as Record<string, unknown>).ready !== "boolean" ||
      ((payload as Record<string, unknown>).challengeId !== null && typeof (payload as Record<string, unknown>).challengeId !== "string") ||
      ((payload as Record<string, unknown>).providerId !== null && typeof (payload as Record<string, unknown>).providerId !== "string"))
      throw new Error("Company sign-in status is unavailable");
    return payload as { userId: string; providerId: string | null; available: boolean; ready: boolean; challengeId: string | null };
  },

  startAccountDeletionSso: async (expectedUserId: string, expectedSessionId: string) => {
    const value = await authPost("/account-deletion/sso/start", {}, expectedUserId, expectedSessionId) as Record<string, unknown>;
    if (value.userId !== expectedUserId || typeof value.challengeId !== "string" ||
      typeof value.providerId !== "string" || typeof value.callbackURL !== "string")
      throw new Error("Company sign-in confirmation is unavailable");
    const callback = new URL(value.callbackURL);
    if (callback.origin !== window.location.origin || callback.pathname !== "/company/settings/security" ||
      callback.searchParams.get("accountDeletionReauth") !== value.challengeId)
      throw new Error("Invalid company sign-in confirmation destination");
    return { challengeId: value.challengeId, providerId: value.providerId, callbackURL: callback.href };
  },

  signInAccountDeletionSso: async (providerId: string, callbackURL: string, expectedUserId: string, expectedSessionId: string) => {
    const value = await authPost("/sign-in/sso", { providerId, callbackURL }, expectedUserId, expectedSessionId) as Record<string, unknown>;
    if (typeof value.url !== "string") throw new Error("Company sign-in redirect is unavailable");
    const target = new URL(value.url);
    if (target.protocol !== "https:" || target.username || target.password) throw new Error("Invalid company sign-in redirect");
    return target.href;
  },

  verifyBackupCode: async (code: string, expectedUserId?: string, expectedSessionId?: string) =>
    nativeAuthenticationConfirmationSchema.parse(await authPost("/two-factor/verify-backup-code", { code }, expectedUserId, expectedSessionId)),

  securityStatus: async (expectedUserId: string, signal?: AbortSignal, expectedSessionId?: string): Promise<NativeAuthenticationSecurity> => {
    const response = await fetch("/api/auth/security", { credentials: "include", cache: "no-store", signal,
      headers: { Accept: "application/json", "X-Blentera-Expected-User": expectedUserId,
        ...(expectedSessionId ? { "X-Blentera-Expected-Session": expectedSessionId } : {}) } });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const recovery = tenantSessionRecovery.recoverIfNeeded(response.status, payload);
      if (recovery) return recovery;
      throw extractAuthError(payload as AuthErrorBody, response.status);
    }
    const status = nativeAuthenticationSecuritySchema.parse(payload);
    if (status.userId !== expectedUserId) throw new AuthApiError("Account changed", 409, null, "ACCOUNT_CHANGED");
    return status;
  },

  enableTwoFactor: async (password: string | undefined, expectedUserId: string, expectedSessionId?: string) =>
    nativeTotpEnrollmentSchema.parse(await authPost("/two-factor/enable", { password, method: "totp" }, expectedUserId, expectedSessionId)),

  generateBackupCodes: async (password: string | undefined, expectedUserId: string, expectedSessionId?: string) =>
    nativeRecoveryCodesSchema.parse(await authPost("/two-factor/generate-backup-codes", { password }, expectedUserId, expectedSessionId)),

  cancelTwoFactorEnrollment: async (expectedUserId: string, expectedSessionId?: string): Promise<void> => {
    await authPost("/two-factor/cancel-enrollment", {}, expectedUserId, expectedSessionId);
  },

  disableTwoFactor: async (password: string | undefined, expectedUserId: string, expectedSessionId?: string): Promise<void> => {
    await authPost("/two-factor/disable", { password }, expectedUserId, expectedSessionId);
  },

  signUpEmail: async (input: { name: string; email: string; password: string }) => {
    await authPost("/sign-up/email", input);
  },

  getPreferences: async (expectedUserId: string): Promise<CurrentUserPreferences> => {
    const res = await fetch(`/api/auth/preferences?expectedUserId=${encodeURIComponent(expectedUserId)}`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      const recovery = tenantSessionRecovery.recoverIfNeeded(res.status, payload);
      if (recovery) return recovery;
      throw extractAuthError(payload as AuthErrorBody, res.status);
    }
    return currentUserPreferencesSchema.parse(payload);
  },

  updatePreferences: (input: UpdateCurrentUserPreferences): Promise<CurrentUserPreferences> =>
    authPatch("/preferences", input, (payload) => currentUserPreferencesSchema.parse(payload)),

  getProfile: async (): Promise<CurrentUserProfile> => {
    const res = await fetch("/api/auth/profile", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      const recovery = tenantSessionRecovery.recoverIfNeeded(res.status, payload);
      if (recovery) return recovery;
      throw new Error((payload as { error?: string } | null)?.error ?? `Failed to load profile (${res.status})`);
    }
    return currentUserProfileSchema.parse(payload);
  },

  updateProfile: async (input: UpdateCurrentUserProfile): Promise<CurrentUserProfile> =>
    authPatch("/profile", input, (payload) => currentUserProfileSchema.parse(payload)),

  signOut: async (): Promise<SignOutResult | null> => {
    const payload = await authPost("/sign-out", {});
    if (!payload || typeof payload !== "object") return null;

    const result = payload as Record<string, unknown>;
    return {
      ...(typeof result.success === "boolean" ? { success: result.success } : {}),
      ...(typeof result.redirectTo === "string" ? { redirectTo: result.redirectTo } : {}),
    };
  },
};
