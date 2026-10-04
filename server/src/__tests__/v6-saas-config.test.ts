import { afterEach, describe, expect, it, vi } from "vitest";
import { getCookies } from "better-auth/cookies";
import type { BetterAuthOptions } from "better-auth";
import { loadConfig } from "../config.js";
import {
  activePublicAppOrigins, assertSaasRolloutReady, parsePublicAppOrigin, publicAppUrl,
  resolveAwDeploymentProfile, resolvePublicOriginConfig, resolveSaasTrustProxy,
} from "../aw-deployment.js";
import { isCloudManagedInstance } from "../services/cloud-instance.js";
import { buildBetterAuthAdvancedOptions, deriveAuthTrustedOrigins } from "../auth/better-auth.js";
import { normalizeExperimentalSettings } from "../services/instance-settings.js";

const ORIGIN = "https://ai.augustworks.dk";
const NEW_ORIGIN = "https://app.augustworks.ai";
afterEach(() => vi.unstubAllEnvs());

function saasEnvironment() {
  vi.stubEnv("PAPERCLIP_CONFIG", `/tmp/aw-v6-missing-config-${process.pid}.json`);
  for (const name of ["PAPERCLIP_PUBLIC_URL", "PAPERCLIP_AUTH_PUBLIC_BASE_URL", "BETTER_AUTH_URL", "BETTER_AUTH_BASE_URL", "PAPERCLIP_API_URL", "PAPERCLIP_MANAGED_RUNTIME_PUBLIC_URL", "PAPERCLIP_DEPLOYMENT_MODE", "PAPERCLIP_DEPLOYMENT_EXPOSURE", "PAPERCLIP_AUTH_BASE_URL_MODE", "PAPERCLIP_AUTH_RATE_LIMIT_ENABLED", "AW_ALLOWED_APP_ORIGINS", "AW_LEGACY_APP_ORIGINS"]) vi.stubEnv(name, "");
  vi.stubEnv("PAPERCLIP_CLOUD_TENANT_SERVER_TOKEN", undefined);
  vi.stubEnv("PAPERCLIP_MANAGED_CONFIG", undefined);
  vi.stubEnv("AW_DEPLOYMENT_PROFILE", "saas");
  vi.stubEnv("AW_PUBLIC_APP_ORIGIN", ORIGIN);
  vi.stubEnv("TRUST_PROXY", "loopback");
  vi.stubEnv("PAPERCLIP_BIND", "loopback");
  vi.stubEnv("HOST", "127.0.0.1");
}

describe("V6 deployment ownership and rollout", () => {
  it("refuses to construct a SaaS app with implicit authority or missing origin policy", async () => {
    const { createApp } = await import("../app.js");
    await expect(createApp({} as never, { deploymentProfile: "saas", deploymentMode: "local_trusted" } as never))
      .rejects.toThrow(/SaaS app requires/);
    await expect(createApp({} as never, { deploymentProfile: "saas", deploymentMode: "authenticated", deploymentExposure: "public" } as never))
      .rejects.toThrow(/SaaS app requires/);
  });
  it("preserves unconfigured local and legacy Cloud profiles without allowing a Cloud-floor bypass", () => {
    expect(resolveAwDeploymentProfile({})).toBe("local");
    expect(resolveAwDeploymentProfile({ PAPERCLIP_MANAGED_CONFIG: "" })).toBe("legacy_managed_stack");
    expect(isCloudManagedInstance({ AW_DEPLOYMENT_PROFILE: "legacy_managed_stack" })).toBe(true);
    expect(isCloudManagedInstance({ AW_DEPLOYMENT_PROFILE: "saas" })).toBe(false);
    expect(() => resolveAwDeploymentProfile({ AW_DEPLOYMENT_PROFILE: "typo" })).toThrow();
    for (const profile of ["saas", "local"]) expect(() => resolveAwDeploymentProfile({ AW_DEPLOYMENT_PROFILE: profile, PAPERCLIP_CLOUD_TENANT_SERVER_TOKEN: "fixture-token" })).toThrow(/legacy Cloud/);
  });

  it("selects authenticated HTTPS SaaS even when the local file defaults are trusted-local", () => {
    saasEnvironment();
    const config = loadConfig();
    expect(config.deploymentProfile).toBe("saas");
    expect(config.deploymentMode).toBe("authenticated");
    expect(config.deploymentExposure).toBe("public");
    expect(config.authBaseUrlMode).toBe("explicit");
    expect(config.authPublicBaseUrl).toBe(ORIGIN);
    expect(config.authDisableSignUp).toBe(true);
    expect(config.companyDeletionEnabled).toBe(false);
    expect(deriveAuthTrustedOrigins(config)).toEqual([ORIGIN]);
    expect(() => assertSaasRolloutReady(config.deploymentProfile, normalizeExperimentalSettings({}))).toThrow(/rollout gate/);
    expect(() => assertSaasRolloutReady("saas", { saas_deployment_profile_v6: true })).not.toThrow();
  });

  it.each([
    ["PAPERCLIP_DEPLOYMENT_MODE", "local_trusted"],
    ["PAPERCLIP_DEPLOYMENT_EXPOSURE", "private"],
    ["PAPERCLIP_AUTH_BASE_URL_MODE", "auto"],
    ["PAPERCLIP_API_URL", "https://other.example"],
    ["PAPERCLIP_PUBLIC_URL", "https://other.example"],
    ["PAPERCLIP_AUTH_RATE_LIMIT_ENABLED", "false"],
    ["PAPERCLIP_AUTH_RATE_LIMIT_ENABLED", " FALSE "],
    ["TRUST_PROXY", "true"],
  ])("fails startup on conflicting or unsafe %s", (name, value) => {
    saasEnvironment(); vi.stubEnv(name, value); expect(() => loadConfig()).toThrow();
  });

  it.each([undefined, "", "true", "1", "false", "0.0.0.0/0", "::/0", "uniquelocal", "linklocal"])("rejects broad/absent SaaS proxy trust: %s", (value) => {
    expect(() => resolveSaasTrustProxy(value)).toThrow();
  });

  it("keeps SaaS cookies secure, HttpOnly, Lax and host-only", () => {
    const advanced = buildBetterAuthAdvancedOptions({ disableSecureCookies: true, saas: true });
    const cookie = getCookies({ baseURL: ORIGIN, advanced } as BetterAuthOptions).sessionToken;
    expect(cookie.attributes).toMatchObject({ secure: true, httpOnly: true, sameSite: "lax" });
    expect(cookie.attributes.domain).toBeUndefined();
  });
});

describe("V6 domain migration substrate", () => {
  it("adds legacy origins only when dual-origin dependencies are enabled", () => {
    const config = resolvePublicOriginConfig({ AW_PUBLIC_APP_ORIGIN: NEW_ORIGIN, AW_ALLOWED_APP_ORIGINS: "https://staging.example.invalid", AW_LEGACY_APP_ORIGINS: ORIGIN });
    expect(activePublicAppOrigins(config, {})).toEqual([NEW_ORIGIN]);
    expect(activePublicAppOrigins(config, { domain_dual_origin_v6: true })).toEqual([NEW_ORIGIN]);
    expect(activePublicAppOrigins(config, { saas_deployment_profile_v6: true, domain_dual_origin_v6: true })).toEqual([NEW_ORIGIN, "https://staging.example.invalid", ORIGIN]);
    expect(publicAppUrl(config, "/invite/opaque")).toBe(`${NEW_ORIGIN}/invite/opaque`);
  });

  it.each(["http://ai.augustworks.dk", `${ORIGIN}/api`, `${ORIGIN}?token=opaque`, `${ORIGIN}#token`, "https://user:password@ai.augustworks.dk", "https://*.augustworks.dk"])("rejects non-origin configuration %s", (value) => {
    expect(() => parsePublicAppOrigin(value)).toThrow();
  });

  it.each(["https://attacker.example", "//attacker.example/path", "/\\attacker.example/path", "/path\r\nLocation: attacker"])("rejects external action paths", (value) => {
    expect(() => publicAppUrl({ primaryAppOrigin: ORIGIN, allowedAppOrigins: [ORIGIN], legacyOrigins: [] }, value)).toThrow();
  });
});
