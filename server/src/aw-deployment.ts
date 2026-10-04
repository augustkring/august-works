import {
  AW_DEPLOYMENT_PROFILES,
  v6FeatureEnabled,
  type AwDeploymentProfile,
  type PublicOriginConfig,
  type V6FeatureFlags,
} from "@paperclipai/shared";
import { parseTrustProxyEnv, type TrustProxyValue } from "./middleware/trust-proxy.js";

type DeploymentEnv = Record<string, string | undefined>;

export function hasLegacyManagedSignal(env: DeploymentEnv): boolean {
  return Boolean(env.PAPERCLIP_CLOUD_TENANT_SERVER_TOKEN?.trim()) || env.PAPERCLIP_MANAGED_CONFIG !== undefined;
}

export function resolveAwDeploymentProfile(env: DeploymentEnv = process.env): AwDeploymentProfile {
  const explicit = env.AW_DEPLOYMENT_PROFILE?.trim();
  if (!explicit) return hasLegacyManagedSignal(env) ? "legacy_managed_stack" : "local";
  if (!AW_DEPLOYMENT_PROFILES.includes(explicit as AwDeploymentProfile)) {
    throw new Error("AW_DEPLOYMENT_PROFILE must be local, legacy_managed_stack or saas");
  }
  if (explicit !== "legacy_managed_stack" && hasLegacyManagedSignal(env)) {
    throw new Error("Remove legacy Cloud credentials/config before selecting a local or SaaS profile");
  }
  return explicit as AwDeploymentProfile;
}

export function isSaasDeployment(env: DeploymentEnv = process.env): boolean {
  return resolveAwDeploymentProfile(env) === "saas";
}

/** Accept only an HTTPS origin; paths, tokens, credentials and wildcards are configuration errors. */
export function parsePublicAppOrigin(value: string): string {
  if (!/^https:\/\/[^\s/\\?#]+\/?$/i.test(value)) {
    throw new Error("Public app origin must contain an HTTPS authority only");
  }
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Public app origin must be a valid HTTPS origin"); }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/"
    || url.search || url.hash || !url.hostname || url.hostname.includes("*") || url.hostname.endsWith(".")) {
    throw new Error("Public app origin must be HTTPS with no credentials, path, query, fragment or wildcard");
  }
  return url.origin;
}

function originList(value: string | undefined): string[] {
  return [...new Set((value ?? "").split(",").map((v) => v.trim()).filter(Boolean).map(parsePublicAppOrigin))];
}

export function resolvePublicOriginConfig(env: DeploymentEnv = process.env): PublicOriginConfig {
  const primary = env.AW_PUBLIC_APP_ORIGIN?.trim();
  if (!primary) throw new Error("SaaS requires AW_PUBLIC_APP_ORIGIN");
  const primaryAppOrigin = parsePublicAppOrigin(primary);
  const allowedAppOrigins = [...new Set([primaryAppOrigin, ...originList(env.AW_ALLOWED_APP_ORIGINS)])];
  const legacyOrigins = originList(env.AW_LEGACY_APP_ORIGINS);
  if (legacyOrigins.some((origin) => allowedAppOrigins.includes(origin))) {
    throw new Error("Legacy origins must be separate from primary/allowed app origins");
  }
  return { primaryAppOrigin, allowedAppOrigins, legacyOrigins };
}

/** SaaS trusts named loopback or explicit proxy IP/subnets, never every peer or a hop count. */
export function resolveSaasTrustProxy(value: string | undefined): TrustProxyValue {
  const parsed = parseTrustProxyEnv(value);
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((entry) =>
    entry === "linklocal" || entry === "uniquelocal" || /\/0$/.test(entry),
  )) {
    throw new Error("SaaS requires TRUST_PROXY=loopback or explicit trusted proxy IP/CIDR addresses");
  }
  return parsed;
}

export function assertSaasRolloutReady(profile: AwDeploymentProfile, flags: Partial<V6FeatureFlags>): void {
  if (profile === "saas" && !v6FeatureEnabled(flags, "saas_deployment_profile_v6")) {
    throw new Error("SaaS deployment requires the saas_deployment_profile_v6 operator rollout gate");
  }
}

export function activePublicAppOrigins(config: PublicOriginConfig, flags: Partial<V6FeatureFlags>): string[] {
  if (!v6FeatureEnabled(flags, "domain_dual_origin_v6")) return [config.primaryAppOrigin];
  return [...new Set([...config.allowedAppOrigins, ...config.legacyOrigins])];
}

/** Action paths stay relative in storage; generate outbound links from configuration only. */
export function publicAppUrl(config: PublicOriginConfig, relativePath: string): string {
  if (!relativePath.startsWith("/") || relativePath.startsWith("//") || /[\\\r\n]/.test(relativePath)) {
    throw new Error("Public app URL requires a same-origin absolute path");
  }
  const url = new URL(relativePath, config.primaryAppOrigin);
  if (url.origin !== config.primaryAppOrigin) throw new Error("Public app URL cannot change origin");
  return url.href;
}
