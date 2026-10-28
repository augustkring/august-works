import { createHash } from "node:crypto";
import type { ConnectionGrant, ToolConnection, ToolConnectionLifecycle } from "@paperclipai/shared";
import { originalOAuthGrantExpiration } from "./tool-oauth-grant-metadata.js";

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

function normalizedScopes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((scope): scope is string => typeof scope === "string" && scope.trim().length > 0)
    .map((scope) => scope.trim()))].sort((left, right) => left.localeCompare(right));
}

/**
 * Customer-safe lifecycle projection over the current connection and grant.
 * It deliberately stores no lifecycle state of its own: grant status, health,
 * OAuth expiry, and GitHub access/webhook metadata remain the source of truth.
 */
export function projectToolConnectionLifecycle(
  connection: ToolConnection,
  grant: ConnectionGrant,
  now = new Date(),
): ToolConnectionLifecycle {
  const github = grant.providerTenant?.github;
  const oauth = grant.providerTenant?.oauth;
  const persistedOAuthExpiry = record(record(grant.providerTenant).oauth).accessTokenExpiresAt;
  const legacyOAuthExpiry = record(record(connection.config).oauth).expiresAt;
  const credentialExpirySource: ToolConnectionLifecycle["credentialExpirySource"] = grant.externalCredential
    ? "vercel_connect_issuance"
    : typeof persistedOAuthExpiry === "string" || typeof legacyOAuthExpiry === "string"
      ? "oauth_access_token"
      : "not_reported";
  const scopes = normalizedScopes(oauth?.scopes ?? connection.externalCredential?.scopes);
  const scopeHash = scopes.length
    ? createHash("sha256").update(JSON.stringify(scopes), "utf8").digest("hex")
    : null;
  const expiration = grant.externalCredential
    ? (() => {
        const value = grant.externalCredential.expiresAt;
        if (typeof value !== "string") return { expiresAtMs: null, invalid: false };
        const parsed = Date.parse(value), valid = Number.isFinite(parsed);
        return { expiresAtMs: valid ? parsed : null, invalid: !valid };
      })()
    : originalOAuthGrantExpiration(grant, { config: connection.config ?? {} });
  const expiresAt = expiration.expiresAtMs === null
    ? null
    : new Date(expiration.expiresAtMs).toISOString();
  const refreshExpiryValue = oauth?.refreshTokenExpiresAt;
  const refreshExpiryMs = typeof refreshExpiryValue === "string" ? Date.parse(refreshExpiryValue) : null;
  const refreshExpirationInvalid = refreshExpiryMs !== null && !Number.isFinite(refreshExpiryMs);
  const refreshTokenExpiresAt = refreshExpiryMs !== null && Number.isFinite(refreshExpiryMs)
    ? new Date(refreshExpiryMs).toISOString()
    : null;
  const refreshCredentialFreshness = refreshExpiryMs === null || !Number.isFinite(refreshExpiryMs)
    ? "unknown" as const
    : refreshExpiryMs <= now.getTime()
      ? "expired" as const
      : refreshExpiryMs <= now.getTime() + 60 * 60_000
        ? "expiring" as const
        : "current" as const;
  const secretExpiryValues = [
    ...(connection.credentialSecretRefs ?? []),
    ...(grant.credentialSecretRefs ?? []),
  ].flatMap((reference) => typeof reference.expiresAt === "string" ? [reference.expiresAt] : []);
  const secretExpiryDates = secretExpiryValues.map((value) => Date.parse(value));
  const secretReferenceExpiryInvalid = secretExpiryDates.some((value) => !Number.isFinite(value));
  const earliestSecretExpiry = secretExpiryDates.filter(Number.isFinite).sort((left, right) => left - right)[0] ?? null;
  const secretReferenceExpiresAt = earliestSecretExpiry === null ? null : new Date(earliestSecretExpiry).toISOString();
  const secretReferenceFreshness = secretReferenceExpiryInvalid
    ? "unknown" as const
    : earliestSecretExpiry === null
      ? "unknown" as const
      : earliestSecretExpiry <= now.getTime()
        ? "expired" as const
        : earliestSecretExpiry <= now.getTime() + 14 * 24 * 60 * 60_000
          ? "expiring" as const
          : "current" as const;
  const credentialFreshness = expiration.invalid
    ? "unknown" as const
    : expiration.expiresAtMs === null
      ? "unknown" as const
      : expiration.expiresAtMs <= now.getTime()
        ? "expired" as const
        : expiration.expiresAtMs <= now.getTime() + 60 * 60_000
          ? "expiring" as const
          : "current" as const;
  const githubConfigured = record(connection.config).sourceTemplateKey === "github";
  // GitHub App installation webhooks have no per-install expiry. Other
  // providers remain unknown until their lifecycle owner reports a contract.
  const subscriptionStatus = githubConfigured
    ? "not_applicable" as const
    : "not_reported" as const;
  const githubAccessUnverified = githubConfigured && (!github?.accessRevision || !github.lastAccessRefreshAt || !github.repositories);
  const githubWebhookUnverified = Boolean(github && github.webhookHealth !== "healthy");
  const connectionHealthUnverified = (connection.healthStatus === "ok" || connection.healthStatus === "healthy") && !connection.healthCheckedAt;
  const externallyRenewableIssuance = credentialExpirySource === "vercel_connect_issuance";

  let state: ToolConnectionLifecycle["state"];
  let action: ToolConnectionLifecycle["action"] = null;
  let reason: string;
  if (grant.status === "revoked") {
    state = "REVOKED";
    reason = "grant_revoked";
    action = "reconnect";
  } else if (grant.status === "needs_reauthorization" || grant.status === "expired") {
    state = "REQUIRES_REAUTH";
    reason = "grant_requires_reauthorization";
    action = "reauthorize";
  } else if (connection.status === "disabled" || connection.status === "archived" || !connection.enabled) {
    state = "PAUSED";
    reason = "connection_paused";
  } else if (refreshCredentialFreshness === "expired") {
    state = "REQUIRES_REAUTH";
    reason = "refresh_credential_expired";
    action = "reauthorize";
  } else if (github && (github.webhookHealth === "unhealthy" || (github.accessRevision && !github.repositories))) {
    state = "PERMISSION_CHANGED";
    reason = "provider_access_changed";
    action = "refresh_access";
  } else if (["failed", "error", "missing_secret"].includes(connection.healthStatus)) {
    state = "ERROR";
    reason = "connection_health_failed";
    action = "inspect_connection";
  } else if (connection.healthStatus === "degraded" || connection.healthStatus === "unchecked" || connection.healthStatus === "unknown" || connectionHealthUnverified || (!externallyRenewableIssuance && (credentialFreshness === "expired" || credentialFreshness === "expiring")) || refreshCredentialFreshness === "expiring" || secretReferenceFreshness === "expired" || secretReferenceFreshness === "expiring" || expiration.invalid || refreshExpirationInvalid || secretReferenceExpiryInvalid || githubAccessUnverified || githubWebhookUnverified) {
    state = "DEGRADED";
    reason = credentialFreshness === "expired"
      ? "access_credential_expired"
      : credentialFreshness === "expiring"
        ? "access_credential_expiring"
        : refreshCredentialFreshness === "expiring"
          ? "refresh_credential_expiring"
          : expiration.invalid
            ? "credential_expiry_invalid"
            : refreshExpirationInvalid
              ? "refresh_credential_expiry_invalid"
              : secretReferenceExpiryInvalid
                ? "secret_reference_expiry_invalid"
                : secretReferenceFreshness === "expired"
                  ? "secret_reference_expired"
                  : secretReferenceFreshness === "expiring"
                    ? "secret_reference_expiring"
              : connection.healthStatus === "unchecked" || connection.healthStatus === "unknown" || connectionHealthUnverified
              ? "health_not_checked"
              : githubAccessUnverified
                ? "provider_access_unverified"
                : githubWebhookUnverified
                  ? "provider_webhook_unverified"
                  : "connection_health_degraded";
    action = githubAccessUnverified ? "refresh_access" : "inspect_connection";
  } else {
    state = "HEALTHY";
    reason = "current_health_and_grant";
  }

  return {
    state,
    reason,
    action,
    grantStatus: grant.status,
    connectionHealth: {
      state: connection.healthStatus,
      checkedAt: connection.healthCheckedAt?.toISOString() ?? null,
    },
    scopeNames: scopes,
    scopeHash,
    credentialExpirySource,
    credentialExpiresAt: expiresAt,
    credentialFreshness,
    refreshTokenExpiresAt,
    refreshCredentialFreshness,
    secretReferenceExpiresAt,
    secretReferenceFreshness,
    accessVersion: github?.accessRevision ?? null,
    lastAccessVerifiedAt: github?.lastAccessRefreshAt ?? grant.externalCredential?.lastVerifiedAt ?? null,
    lastCredentialRefreshedAt: oauth?.refreshedAt ?? null,
    webhook: github ? {
      health: github.webhookHealth ?? "pending",
      lastDeliveryAt: github.lastWebhookAt ?? null,
      expiry: "not_applicable",
    } : null,
    operations: {
      credentialRefresh: connection.authKind === "oauth" ? "provider_dependent" : "not_applicable",
      subscriptionRenewal: subscriptionStatus,
      syncReconciliation: "not_reported",
      pause: "supported",
      revoke: "supported",
      deprecation: "not_reported",
    },
    subscription: {
      state: subscriptionStatus,
      expiresAt: null,
      renewal: subscriptionStatus,
    },
    providerLifecycle: "not_reported",
    syncReconciliation: "not_reported",
  };
}
