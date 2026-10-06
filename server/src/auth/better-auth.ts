import { enterpriseAuthPlugins, ENTERPRISE_DISABLED_AUTH_PATHS } from "./enterprise-auth-plugins.js";
import { enterpriseIdentityPolicies, enterpriseSubjectBindings, ssoProvider, scimConnectionBinding, scimIdentityTombstone, scimSubject, scimUser, scimProjectionGrant, scimGroup, scimGroupMember, companyMemberships, principalPermissionGrants, activityLog } from "@paperclipai/db";
import type { Request, RequestHandler } from "express";
import type { IncomingHttpHeaders } from "node:http";
import { betterAuth, type Auth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { toNodeHandler } from "better-auth/node";
import type { Db } from "@paperclipai/db";
import {
  authAccounts,
  authSessions,
  authUsers,
  authVerifications,
  authRateLimits,
} from "@paperclipai/db";
import type { Config } from "../config.js";
import { resolvePaperclipInstanceId } from "../home-paths.js";
import {
  workspaceLoginHandoffPlugin,
  type WorkspaceHandoffExpectedIdentity,
} from "./workspace-login-handoff-plugin.js";
import {
  normalizeWorkspaceHandoffOrigin,
  resolveWorkspaceHandoffLocalCompanyId,
  resolveWorkspaceHandoffLocalKey,
  resolveWorkspaceHandoffLocalWorkspaceId,
} from "./workspace-login-handoff.js";

export type BetterAuthSessionUser = {
  id: string;
  email?: string | null;
  name?: string | null;
};

export type BetterAuthSessionResult = {
  session: { id: string; userId: string } | null;
  user: BetterAuthSessionUser | null;
};

type BetterAuthGetSessionApi = {
  getSession?: (input: { headers: Headers }) => Promise<unknown>;
};

type BetterAuthHandlerTarget = Extract<Parameters<typeof toNodeHandler>[0], { handler: Auth["handler"] }>;

type BetterAuthSessionResolver = {
  api?: BetterAuthGetSessionApi;
};

type BetterAuthInstance = BetterAuthHandlerTarget & BetterAuthSessionResolver;

const AUTH_COOKIE_PREFIX_FALLBACK = "default";
const AUTH_COOKIE_PREFIX_INVALID_SEGMENTS_RE = /[^a-zA-Z0-9_-]+/g;

export function deriveAuthCookiePrefix(instanceId = resolvePaperclipInstanceId()): string {
  const scopedInstanceId = instanceId
    .trim()
    .replace(AUTH_COOKIE_PREFIX_INVALID_SEGMENTS_RE, "-")
    .replace(/^-+|-+$/g, "") || AUTH_COOKIE_PREFIX_FALLBACK;
  return `paperclip-${scopedInstanceId}`;
}

export function buildBetterAuthAdvancedOptions(input: { disableSecureCookies: boolean; saas?: boolean }) {
  return {
    cookiePrefix: deriveAuthCookiePrefix(),
    ...(input.saas ? {
      useSecureCookies: true,
      crossSubDomainCookies: { enabled: false },
      defaultCookieAttributes: { secure: true, httpOnly: true, sameSite: "lax" as const },
    } : {}),
    ...(!input.saas && input.disableSecureCookies ? { useSecureCookies: false } : {}),
  };
}

export function shouldEnableAuthRateLimit(input: {
  deploymentMode: Config["deploymentMode"];
  deploymentExposure?: Config["deploymentExposure"];
  override?: string | undefined;
}): boolean {
  const override = input.override?.trim().toLowerCase();
  if (override === "true") return true;
  if (override === "false") return false;

  return input.deploymentMode === "authenticated";
}

export function buildBetterAuthRateLimitOptions(input: {
  deploymentMode: Config["deploymentMode"];
  deploymentExposure?: Config["deploymentExposure"];
  override?: string | undefined;
}) {
  return {
    enabled: shouldEnableAuthRateLimit(input),
  };
}

export function shouldDisableSecureAuthCookies(input: {
  deploymentMode: Config["deploymentMode"];
  deploymentExposure?: Config["deploymentExposure"];
  authBaseUrlMode: Config["authBaseUrlMode"];
  authPublicBaseUrl: string | undefined;
  publicUrl?: string | undefined;
  managedRuntimePublicUrl?: string | undefined;
  requestUrl?: string | undefined;
}): boolean {
  const publicUrl = (
    input.publicUrl?.trim() ||
    (input.authBaseUrlMode === "explicit" ? input.authPublicBaseUrl?.trim() : "")
  );
  if (
    input.deploymentMode === "authenticated" &&
    isHttpsUrl(publicUrl) &&
    isHttpsUrl(input.managedRuntimePublicUrl) &&
    isHttpLoopbackUrl(input.requestUrl)
  ) {
    return true;
  }
  if (publicUrl) return publicUrl.startsWith("http://");

  return (
    input.deploymentMode === "authenticated" &&
    (
      (input.deploymentExposure === "private" && input.authBaseUrlMode === "auto") ||
      input.deploymentExposure === undefined
    )
  );
}

function isHttpsUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "[::1]" ||
    normalized === "::1"
  );
}

function isHttpLoopbackUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" && isLoopbackHostname(url.hostname);
  } catch {
    return false;
  }
}

function requestUrlFromHeaders(headers: Headers): string | undefined {
  const host = headers.get("host")?.trim();
  if (!host) return undefined;

  const forwardedProtocol = headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim().toLowerCase();
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "https"
    ? forwardedProtocol
    : (() => {
      try {
        return isLoopbackHostname(new URL(`http://${host}`).hostname) ? "http" : "https";
      } catch {
        return "https";
      }
    })();
  return `${protocol}://${host}`;
}

function headersFromNodeHeaders(rawHeaders: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [key, raw] of Object.entries(rawHeaders)) {
    if (!raw) continue;
    if (Array.isArray(raw)) {
      for (const value of raw) headers.append(key, value);
      continue;
    }
    headers.set(key, raw);
  }
  return headers;
}

function headersFromExpressRequest(req: Request): Headers {
  return headersFromNodeHeaders(req.headers);
}

export function deriveAuthTrustedOrigins(config: Config, opts?: { listenPort?: number; publicAppOrigins?: readonly string[] }): string[] {
  if (config.deploymentProfile === "saas") {
    if (!config.publicOriginConfig) throw new Error("SaaS public origin configuration is missing");
    return [...(opts?.publicAppOrigins ?? [config.publicOriginConfig.primaryAppOrigin])];
  }
  const baseUrl = config.authBaseUrlMode === "explicit" ? config.authPublicBaseUrl : undefined;
  const trustedOrigins = new Set<string>();

  if (baseUrl) {
    try {
      trustedOrigins.add(new URL(baseUrl).origin);
    } catch {
      // Better Auth will surface invalid base URL separately.
    }
  }
  if (config.deploymentMode === "authenticated") {
    const port = opts?.listenPort ?? config.port;
    const needsPortVariants = port !== 80 && port !== 443;
    for (const hostname of config.allowedHostnames) {
      const trimmed = hostname.trim().toLowerCase();
      if (!trimmed) continue;
      trustedOrigins.add(`https://${trimmed}`);
      trustedOrigins.add(`http://${trimmed}`);
      if (needsPortVariants) {
        trustedOrigins.add(`https://${trimmed}:${port}`);
        trustedOrigins.add(`http://${trimmed}:${port}`);
      }
    }
  }

  return Array.from(trustedOrigins);
}

/**
 * Identity a managed workspace instance compares an inbound handoff ticket
 * against. Every field comes from persisted configuration or injected runtime
 * identity — never from request headers — so a spoofed `X-Forwarded-Host` or
 * Tailscale identity header cannot retarget a ticket. Returns null when this
 * process was not started as a managed workspace, which leaves the exchange
 * endpoint unregistered.
 */
export function resolveWorkspaceHandoffIdentity(
  config: Config,
  env: NodeJS.ProcessEnv = process.env,
): WorkspaceHandoffExpectedIdentity | null {
  if (config.deploymentProfile === "saas") return null;
  const key = resolveWorkspaceHandoffLocalKey(env);
  if (!key) return null;
  const configuredOrigin =
    normalizeWorkspaceHandoffOrigin(env.PAPERCLIP_PUBLIC_URL)
    ?? (config.authBaseUrlMode === "explicit"
      ? normalizeWorkspaceHandoffOrigin(config.authPublicBaseUrl)
      : null);
  return {
    key,
    instanceId: resolvePaperclipInstanceId(),
    executionWorkspaceId: resolveWorkspaceHandoffLocalWorkspaceId(env),
    companyId: resolveWorkspaceHandoffLocalCompanyId(env),
    origin: configuredOrigin,
  };
}

export type SaasAuthDelivery = {
  signupEnabled: boolean;
  verificationRequired: boolean;
  sendVerification(input: { user: { id: string; email: string }; url: string; token: string }): Promise<void>;
  sendPasswordReset(input: { user: { id: string; email: string }; url: string; token: string }): Promise<void>;
  recordSecurityEvent(userId: string, action: "email_verified" | "password_reset_completed"): Promise<void>;
};

export function createBetterAuthInstance(db: Db, config: Config, trustedOrigins: string[], saasDelivery?: SaasAuthDelivery): BetterAuthInstance {
  if (saasDelivery && config.deploymentProfile !== "saas") throw new Error("SaaS authentication delivery requires SaaS profile");
  const baseUrl = config.authBaseUrlMode === "explicit" ? config.authPublicBaseUrl : undefined;
  const publicUrl = process.env.PAPERCLIP_PUBLIC_URL?.trim() || baseUrl;
  const managedRuntimePublicUrl = process.env.PAPERCLIP_MANAGED_RUNTIME_PUBLIC_URL?.trim() || undefined;
  const secret = process.env.BETTER_AUTH_SECRET ?? process.env.PAPERCLIP_AGENT_JWT_SECRET;
  if (!secret) {
    throw new Error(
      "BETTER_AUTH_SECRET (or PAPERCLIP_AGENT_JWT_SECRET) must be set. " +
      "For local development, set BETTER_AUTH_SECRET=paperclip-dev-secret in your .env file.",
    );
  }
  const disableSecureCookies = config.deploymentProfile !== "saas" && shouldDisableSecureAuthCookies({
    deploymentMode: config.deploymentMode,
    deploymentExposure: config.deploymentExposure,
    authBaseUrlMode: config.authBaseUrlMode,
    authPublicBaseUrl: config.authPublicBaseUrl,
    publicUrl,
  });

  const enterprisePlugins = config.deploymentProfile === "saas" && config.saasPlatform && config.publicOriginConfig ? enterpriseAuthPlugins(db, config.saasPlatform.deployment.sourceSha) : [];
  const authConfig = {
    baseURL: baseUrl,
    secret,
    trustedOrigins,
    database: drizzleAdapter(db, {
      provider: "pg",
      transaction: enterprisePlugins.length > 0,
      schema: {
        user: authUsers,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
        ...(config.deploymentProfile === "saas" ? {rateLimit:authRateLimits} : {}),
        ...(enterprisePlugins.length ? { ssoProvider,scimConnectionBinding,scimIdentityTombstone,scimSubject,scimUser,scimProjectionGrant,scimGroup,scimGroupMember,awEnterprisePolicy:enterpriseIdentityPolicies,awEnterpriseBinding:enterpriseSubjectBindings,awCompanyMembership:companyMemberships,awPermissionGrant:principalPermissionGrants,awActivity:activityLog } : {}),
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: saasDelivery?.verificationRequired ?? false,
      disableSignUp: config.deploymentProfile === "saas" ? !(saasDelivery?.signupEnabled) : config.authDisableSignUp,
      ...(saasDelivery ? {
        minPasswordLength: 12,
        maxPasswordLength: 128,
        resetPasswordTokenExpiresIn: 900,
        revokeSessionsOnPasswordReset: true,
        sendResetPassword: saasDelivery.sendPasswordReset,
        onPasswordReset: async ({ user }: { user: { id: string } }) => saasDelivery.recordSecurityEvent(user.id, "password_reset_completed"),
      } : {}),
    },
    ...(saasDelivery ? { emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      expiresIn: 3600,
      sendVerificationEmail: saasDelivery.sendVerification,
      afterEmailVerification: async (user: { id: string }) => saasDelivery.recordSecurityEvent(user.id, "email_verified"),
    } } : {}),
    rateLimit: { ...buildBetterAuthRateLimitOptions({
      deploymentMode: config.deploymentMode,
      deploymentExposure: config.deploymentExposure,
      override: config.deploymentProfile === "saas" ? "true" : process.env.PAPERCLIP_AUTH_RATE_LIMIT_ENABLED,
    }), ...(config.deploymentProfile === "saas" ? { storage: "database" as const } : {}) },
    advanced: buildBetterAuthAdvancedOptions({ disableSecureCookies, saas: config.deploymentProfile === "saas" }),
    ...(enterprisePlugins.length ? { disabledPaths: ENTERPRISE_DISABLED_AUTH_PATHS } : {}),
    plugins: [ ...enterprisePlugins, ...(resolveWorkspaceHandoffIdentity(config) ? [workspaceLoginHandoffPlugin({ db,
      resolveExpectedIdentity: () => resolveWorkspaceHandoffIdentity(config) ?? {key:null,instanceId:null,executionWorkspaceId:null,companyId:null,origin:null},
    })] : []) ],
  };

  if (!baseUrl) {
    delete (authConfig as { baseURL?: string }).baseURL;
  }

  const defaultAuth = betterAuth(authConfig);
  const supportsManagedLoopbackAuth = Boolean(
    config.deploymentProfile !== "saas" && !disableSecureCookies &&
    isHttpsUrl(publicUrl) &&
    isHttpsUrl(managedRuntimePublicUrl),
  );
  if (!supportsManagedLoopbackAuth) return defaultAuth;

  // Better Auth fixes both the Secure attribute and the __Secure- name prefix
  // when an instance is created. Keep the public instance unchanged and route
  // only managed HTTP-loopback requests through a cookie-compatible instance.
  const loopbackAuth = betterAuth({
    ...authConfig,
    advanced: buildBetterAuthAdvancedOptions({ disableSecureCookies: true }),
  });
  const cookieSecurityInput = {
    deploymentMode: config.deploymentMode,
    deploymentExposure: config.deploymentExposure,
    authBaseUrlMode: config.authBaseUrlMode,
    authPublicBaseUrl: config.authPublicBaseUrl,
    publicUrl,
    managedRuntimePublicUrl,
  };

  return {
    handler: (request) => {
      const auth = shouldDisableSecureAuthCookies({
        ...cookieSecurityInput,
        requestUrl: request.url,
      }) ? loopbackAuth : defaultAuth;
      return auth.handler(request);
    },
    api: {
      getSession: (input) => {
        const auth = shouldDisableSecureAuthCookies({
          ...cookieSecurityInput,
          requestUrl: requestUrlFromHeaders(input.headers),
        }) ? loopbackAuth : defaultAuth;
        return auth.api.getSession(input);
      },
    },
  };
}

export function createBetterAuthHandler(auth: BetterAuthHandlerTarget): RequestHandler {
  const handler = toNodeHandler(auth);
  return (req, res, next) => {
    void Promise.resolve(handler(req, res)).catch(next);
  };
}

export async function resolveBetterAuthSessionFromHeaders(
  auth: BetterAuthSessionResolver,
  headers: Headers,
): Promise<BetterAuthSessionResult | null> {
  const api = auth.api;
  if (!api?.getSession) return null;

  const sessionValue = await api.getSession({
    headers,
  });
  if (!sessionValue || typeof sessionValue !== "object") return null;

  const value = sessionValue as {
    session?: { id?: string; userId?: string } | null;
    user?: { id?: string; email?: string | null; name?: string | null } | null;
  };
  const session = value.session?.id && value.session.userId
    ? { id: value.session.id, userId: value.session.userId }
    : null;
  const user = value.user?.id
    ? {
        id: value.user.id,
        email: value.user.email ?? null,
        name: value.user.name ?? null,
      }
    : null;

  if (!session || !user) return null;
  return { session, user };
}

export async function resolveBetterAuthSession(
  auth: BetterAuthSessionResolver,
  req: Request,
): Promise<BetterAuthSessionResult | null> {
  return resolveBetterAuthSessionFromHeaders(auth, headersFromExpressRequest(req));
}
