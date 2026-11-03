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

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function providerId(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]{0,30}$/.test(value);
}

/** Hash the provider account identity without exposing the account ID. */
export function githubRepositoryAccessSourceIdentityHash(userId: unknown): string | null {
  return providerId(userId) ? sha256({ provider: "github", userId }) : null;
}

/** Bind a complete access snapshot to both OAuth scopes and its resource membership. */
export function githubRepositoryAccessScopeHash(
  scopes: unknown,
  installationIds: unknown,
  repositories: unknown,
): string | null {
  if (!Array.isArray(scopes) || !Array.isArray(installationIds) || installationIds.length === 0 ||
    !installationIds.every(providerId) || !Array.isArray(repositories) || repositories.length === 0) return null;
  const normalized = normalizedScopes(scopes);
  const installations = [...new Set(installationIds as string[])].sort();
  const repositoryScope = repositories.flatMap((value) => {
    const item = record(value);
    if (!providerId(item.id) || !providerId(item.installationId) || !installations.includes(item.installationId)) return [];
    return [{ id: item.id, installationId: item.installationId }];
  }).sort((left, right) => left.id.localeCompare(right.id) || left.installationId.localeCompare(right.installationId));
  if (repositoryScope.length !== repositories.length) return null;
  return sha256({ provider: "github", scopes: normalized, installations, repositories: repositoryScope });
}

/** Exact private progress pin used by the GitHub owner before its refresh CAS. */
export function githubRepositoryAccessProgressHash(githubValue: unknown, scopes: unknown): string {
  const github = record(githubValue);
  const repositories = Array.isArray(github.repositories) ? github.repositories.map((value) => {
    const item = record(value);
    return { id: item.id ?? null, fullName: item.fullName ?? null, installationId: item.installationId ?? null, private: item.private ?? null };
  }).sort((left, right) => String(left.id).localeCompare(String(right.id))) : null;
  return sha256({
    sourceIdentityHash: githubRepositoryAccessSourceIdentityHash(github.userId),
    scopeHash: githubRepositoryAccessScopeHash(scopes, github.installationIds, github.repositories),
    accessRevision: github.accessRevision ?? null,
    lastAccessRefreshAt: github.lastAccessRefreshAt ?? null,
    lastWebhookAt: github.lastWebhookAt ?? null,
    webhookHealth: github.webhookHealth ?? null,
    login: github.login ?? null,
    avatarUrl: github.avatarUrl ?? null,
    installationCount: github.installationCount ?? null,
    repositoryCount: github.repositoryCount ?? null,
    repositorySelection: github.repositorySelection ?? null,
    installationIds: Array.isArray(github.installationIds) ? [...github.installationIds].sort() : null,
    installationOwnerLogins: Array.isArray(github.installationOwnerLogins) ? [...github.installationOwnerLogins].sort() : null,
    installationUrl: github.installationUrl ?? null,
    managementUrl: github.managementUrl ?? null,
    appSlug: github.appSlug ?? null,
    repositorySnapshotHash: repositories === null ? null : sha256(repositories),
    repositoryAccessReconciliation: record(github.repositoryAccessReconciliation),
  });
}

/** GitHub's current periodic owner cadence for repository-access full snapshots. */
export const GITHUB_REPOSITORY_ACCESS_RECONCILE_INTERVAL_MS = 60 * 60_000;

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
  // A missing repository snapshot always requires the existing paginated full
  // read, including for grants created before the local revision existed. This
  // is not a provider delivery cursor: opaque event IDs provide no completeness proof.
  const localAccessRevision = typeof github?.accessRevision === "string" && github.accessRevision.length > 0
    ? github.accessRevision
    : null;
  const repositorySnapshot = github?.repositories;
  const installations = github?.installationIds;
  const repositoryCount = github?.repositoryCount;
  const hasFullRepositorySnapshot = Array.isArray(repositorySnapshot) && repositorySnapshot.length > 0 &&
    repositorySnapshot.length === repositoryCount && Array.isArray(installations) && installations.length > 0;
  const accessSync = record(github?.repositoryAccessReconciliation);
  const currentRepositoryScopeHash = githubRepositoryAccessScopeHash(oauth?.scopes, installations, repositorySnapshot);
  const currentRepositoryIdentityHash = githubRepositoryAccessSourceIdentityHash(github?.userId);
  const recordedRepositoryScopeHash = typeof accessSync.scopeHash === "string" ? accessSync.scopeHash : null;
  const recordedRepositoryIdentityHash = typeof accessSync.sourceIdentityHash === "string" ? accessSync.sourceIdentityHash : null;
  const hashesMatch = Boolean(currentRepositoryScopeHash && currentRepositoryIdentityHash &&
    currentRepositoryScopeHash === recordedRepositoryScopeHash && currentRepositoryIdentityHash === recordedRepositoryIdentityHash);
  const parseTimestamp = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(Date.parse(value)).toISOString() : null;
  const lastSuccessAt = parseTimestamp(accessSync.lastSuccessAt);
  const lastFullReconciledAt = parseTimestamp(accessSync.lastFullReconciledAt);
  const lastAttemptAt = parseTimestamp(accessSync.lastAttemptAt);
  const nextAttemptAt = parseTimestamp(accessSync.nextAttemptAt);
  const rateLimitRetryAt = parseTimestamp(accessSync.rateLimitRetryAt);
  const accessRefreshTimestamp = parseTimestamp(github?.lastAccessRefreshAt);
  const refreshDueAt = nextAttemptAt
    ? Date.parse(nextAttemptAt)
    : lastFullReconciledAt
      ? Date.parse(lastFullReconciledAt) + GITHUB_REPOSITORY_ACCESS_RECONCILE_INTERVAL_MS
      : Number.NEGATIVE_INFINITY;
  const snapshotStale = refreshDueAt <= now.getTime();
  const rateLimitActive = rateLimitRetryAt !== null && Date.parse(rateLimitRetryAt) > now.getTime() ||
    accessSync.lastErrorCode === "github_rate_limited" && nextAttemptAt !== null && Date.parse(nextAttemptAt) > now.getTime();
  let requiredReason: ToolConnectionLifecycle["syncReconciliation"]["requiredReason"] = "not_reported";
  if (githubConfigured) {
    if (accessSync.state === "required" && [
      "snapshot_missing", "periodic_reconcile_due", "source_event_invalidated", "source_or_scope_mismatch", "provider_failure",
    ].includes(String(accessSync.requiredReason))) requiredReason = accessSync.requiredReason as typeof requiredReason;
    else if (accessSync.state === "required") requiredReason = "provider_failure";
    else if (!hasFullRepositorySnapshot) requiredReason = "snapshot_missing";
    else if (accessSync.state === "reconciled" && !hashesMatch) requiredReason = "source_or_scope_mismatch";
    else if (accessSync.state === "reconciled" && snapshotStale) requiredReason = "periodic_reconcile_due";
  }
  const repositoryAccessState = githubConfigured &&
    (!hasFullRepositorySnapshot || accessSync.state === "required" || accessSync.state === "reconciled" && !hashesMatch || snapshotStale)
    ? "required" as const
    : githubConfigured && accessSync.state === "reconciled" && hashesMatch && lastSuccessAt && lastFullReconciledAt
      ? "reconciled" as const
      : "not_reported" as const;
  const syncReconciliation: ToolConnectionLifecycle["syncReconciliation"] = {
    domain: githubConfigured ? "repository_access" : "not_reported",
    state: repositoryAccessState,
    mode: githubConfigured ? "github_repository_full_snapshot" : "not_reported",
    requiredReason,
    accessRevision: localAccessRevision,
    accessRevisionKind: localAccessRevision ? "local_access_revision" : "not_reported",
    lastSuccessAt,
    lastFullReconciledAt,
    lastAttemptAt,
    nextAttemptAt,
    lastErrorCode: typeof accessSync.lastErrorCode === "string" && /^[a-z0-9_]{1,64}$/.test(accessSync.lastErrorCode)
      ? accessSync.lastErrorCode : null,
    rateLimitState: rateLimitActive ? "limited" : "not_reported",
    rateLimitRetryAt,
    scopeHash: recordedRepositoryScopeHash,
    sourceIdentityHash: recordedRepositoryIdentityHash,
    cursor: "not_reported",
    watermark: "not_reported",
    gapDetection: "not_reported",
  };
  const knownObjectRefresh: ToolConnectionLifecycle["knownObjectRefresh"] = githubConfigured
    ? {
        domain: "github_known_issue_or_pull_request",
        mode: "conditional_canonical_get",
        versionKind: "github_updated_at_and_object_etag",
        completeness: "known_objects_only",
        cursor: "not_reported",
      }
    : {
        domain: "not_reported",
        mode: "not_reported",
        versionKind: "not_reported",
        completeness: "not_reported",
        cursor: "not_reported",
      };
  // GitHub App installation webhooks have no per-install expiry. Other
  // providers remain unknown until their lifecycle owner reports a contract.
  const subscriptionStatus = githubConfigured
    ? "not_applicable" as const
    : "not_reported" as const;
  const githubAccessUnverified = githubConfigured && (!localAccessRevision || !accessRefreshTimestamp || !hasFullRepositorySnapshot || repositoryAccessState === "required");
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
  } else if (github && (github.webhookHealth === "unhealthy" || repositoryAccessState === "required")) {
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
      syncReconciliation: githubConfigured ? "github_full_snapshot" : "not_reported",
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
    syncReconciliation,
    knownObjectRefresh,
  };
}
