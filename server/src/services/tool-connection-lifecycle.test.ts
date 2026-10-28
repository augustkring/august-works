import { describe, expect, it } from "vitest";
import type { ConnectionGrant, ToolConnection } from "@paperclipai/shared";
import { projectToolConnectionLifecycle } from "./tool-connection-lifecycle.js";

const connection = (overrides: Partial<ToolConnection> = {}): ToolConnection => ({
  id: "connection-1", companyId: "company-1", applicationId: "app-1", name: "GitHub", uid: "github",
  connectionKind: "managed", connectionPurpose: "tool", ownership: "customer", transport: "rest_api",
  authKind: "oauth", credentialSource: "paperclip_vault", credentialPolicy: "shared", status: "active",
  transportConfig: {}, config: { sourceTemplateKey: "github" }, credentialSecretRefs: [], credentialRefs: [],
  healthStatus: "ok", healthCheckedAt: new Date("2026-10-28T00:00:00Z"), lastError: null, enabled: true,
  createdByAgentId: null, createdByUserId: "owner-1", createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-10-28T00:00:00Z"), ...overrides,
});
const grant = (overrides: Partial<ConnectionGrant> = {}): ConnectionGrant => ({
  id: "grant-1", companyId: "company-1", connectionId: "connection-1", kind: "organization",
  subjectUserId: null, providerTenant: { oauth: { scopes: ["repo", "read:user"], accessTokenExpiresAt: "2026-10-28T02:00:00.000Z" } },
  credentialSecretRefs: [], status: "active", isDefault: true, createdByAgentId: null, createdByUserId: "owner-1",
  revokedAt: null, revokedByAgentId: null, revokedByUserId: null, lastUsedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-10-28T00:00:00Z"), ...overrides,
});

describe("tool connection lifecycle projection", () => {
  const now = new Date("2026-10-28T00:00:00Z");

  it("projects current grant scopes, scope hash, expiry and provider verification without credentials", () => {
    const result = projectToolConnectionLifecycle(connection({ config: {} }), grant(), now);
    expect(result).toMatchObject({
      state: "HEALTHY", action: null, grantStatus: "active", scopeNames: ["read:user", "repo"],
      credentialExpiresAt: "2026-10-28T02:00:00.000Z", credentialFreshness: "current",
      providerLifecycle: "not_reported", syncReconciliation: "not_reported",
    });
    expect(result.scopeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result).not.toHaveProperty("accessToken");
    expect(result).not.toHaveProperty("refreshToken");
    expect(JSON.stringify(result)).not.toContain("secret-value");
  });

  it("requires reauthorization and keeps explicit revocation distinct from health", () => {
    expect(projectToolConnectionLifecycle(connection(), grant({ status: "needs_reauthorization" }), now))
      .toMatchObject({ state: "REQUIRES_REAUTH", action: "reauthorize" });
    expect(projectToolConnectionLifecycle(connection(), grant({ status: "revoked" }), now))
      .toMatchObject({ state: "REVOKED", action: "reconnect" });
  });

  it("separates refreshable access expiry from expired refresh credentials", () => {
    expect(projectToolConnectionLifecycle(connection(), grant({
      providerTenant: { oauth: { scopes: ["repo"], accessTokenExpiresAt: "2026-10-27T23:00:00.000Z" } },
    }), now)).toMatchObject({ state: "DEGRADED", reason: "access_credential_expired", credentialFreshness: "expired" });
    expect(projectToolConnectionLifecycle(connection(), grant({
      providerTenant: { oauth: { scopes: ["repo"], refreshTokenExpiresAt: "2026-10-27T23:00:00.000Z" } },
    }), now)).toMatchObject({ state: "REQUIRES_REAUTH", reason: "refresh_credential_expired", action: "reauthorize" });
  });

  it("denies a healthy label for malformed grant expiry and preserves grant-over-config precedence", () => {
    const result = projectToolConnectionLifecycle(connection({ config: { oauth: { expiresAt: "2027-01-01T00:00:00.000Z" } } }), grant({
      providerTenant: { oauth: { accessTokenExpiresAt: "not-a-date" } },
    }), now);
    expect(result).toMatchObject({ state: "DEGRADED", reason: "credential_expiry_invalid", credentialFreshness: "unknown", credentialExpiresAt: null });
    expect(projectToolConnectionLifecycle(connection({ config: {} }), grant({
      providerTenant: { oauth: { refreshTokenExpiresAt: "malformed" } },
    }), now)).toMatchObject({ state: "DEGRADED", reason: "refresh_credential_expiry_invalid" });
  });

  it("projects configured secret-reference expiry without returning secret identifiers", () => {
    const result = projectToolConnectionLifecycle(connection({ config: {} }), grant({
      credentialSecretRefs: [{ secretId: "private-secret-id", configPath: "apiKey", expiresAt: "2026-11-01T00:00:00.000Z" }],
    }), now);
    expect(result).toMatchObject({ state: "DEGRADED", reason: "secret_reference_expiring", secretReferenceFreshness: "expiring" });
    expect(result.secretReferenceExpiresAt).toBe("2026-11-01T00:00:00.000Z");
    expect(JSON.stringify(result)).not.toContain("private-secret-id");
  });

  it("uses the current Vercel Connect grant's expiry and verification metadata over connection fallbacks", () => {
    const result = projectToolConnectionLifecycle(connection({
      credentialSource: "vercel_connect",
      externalCredential: { provider: "vercel_connect", connectorId: "connector-1", connectorUid: "uid-1", service: "github", connectorType: "github", principalMode: "app", headerName: "authorization", scopes: ["repo"] },
      config: { oauth: { expiresAt: "2027-01-01T00:00:00.000Z" } },
    }), grant({
      externalCredential: { provider: "vercel_connect", subjectType: "app", expiresAt: "2026-10-28T00:30:00.000Z", lastVerifiedAt: "2026-10-27T23:00:00.000Z" },
    }), now);
    expect(result).toMatchObject({
      state: "HEALTHY", credentialExpirySource: "vercel_connect_issuance", credentialExpiresAt: "2026-10-28T00:30:00.000Z", credentialFreshness: "expiring", lastAccessVerifiedAt: "2026-10-27T23:00:00.000Z",
    });
  });

  it("does not claim verified GitHub health while access or webhook proof is pending", () => {
    const noMetadata = projectToolConnectionLifecycle(connection(), grant(), now);
    expect(noMetadata).toMatchObject({ state: "DEGRADED", reason: "provider_access_unverified", action: "refresh_access" });
    const pendingWebhook = projectToolConnectionLifecycle(connection(), grant({ providerTenant: {
      oauth: { scopes: ["repo"] },
      github: { userId: "123", login: "octocat", installationCount: 1, repositoryCount: 1,
        repositorySelection: "selected", installationIds: ["456"], installationOwnerLogins: ["octo"],
        repositories: [{ id: "789", fullName: "octo/project", installationId: "456" }],
        accessRevision: "version-1", lastAccessRefreshAt: "2026-10-27T00:00:00.000Z", webhookHealth: "pending" },
    } }), now);
    expect(pendingWebhook).toMatchObject({ state: "DEGRADED", reason: "provider_webhook_unverified", webhook: { health: "pending" } });
  });

  it("treats GitHub repository access invalidation as a refresh action, never as webhook-complete sync", () => {
    const item = grant({ providerTenant: { github: {
      userId: "123", login: "octocat", installationCount: 1, repositoryCount: 2,
      repositorySelection: "selected", installationIds: ["456"], installationOwnerLogins: ["octo"],
      accessRevision: "version-2", lastAccessRefreshAt: "2026-10-27T00:00:00.000Z",
      lastWebhookAt: "2026-10-27T01:00:00.000Z", webhookHealth: "unhealthy",
    } } });
    expect(projectToolConnectionLifecycle(connection({ healthStatus: "failed" }), item, now)).toMatchObject({
      state: "PERMISSION_CHANGED", action: "refresh_access", accessVersion: "version-2",
      webhook: { health: "unhealthy", lastDeliveryAt: "2026-10-27T01:00:00.000Z", expiry: "not_applicable" },
      syncReconciliation: "not_reported",
    });
  });

  it("does not call an unverified or unhealthy connection healthy and exposes paused state", () => {
    expect(projectToolConnectionLifecycle(connection({ healthStatus: "unchecked" }), grant(), now))
      .toMatchObject({ state: "DEGRADED", reason: "health_not_checked" });
    expect(projectToolConnectionLifecycle(connection({ healthStatus: "unknown" }), grant(), now))
      .toMatchObject({ state: "DEGRADED", reason: "health_not_checked" });
    expect(projectToolConnectionLifecycle(connection({ healthCheckedAt: null }), grant(), now))
      .toMatchObject({ state: "DEGRADED", reason: "health_not_checked" });
    expect(projectToolConnectionLifecycle(connection({ enabled: false }), grant(), now))
      .toMatchObject({ state: "PAUSED" });
  });
});
