const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Original grant metadata takes precedence over the connection fallback.
 * No credentials are resolved and no provider operation is performed. */
export function originalOAuthGrantExpiration(grant: { providerTenant?: unknown }, connection: { config?: unknown }) {
  const grantExpiry = record(record(grant.providerTenant).oauth).accessTokenExpiresAt;
  const value = typeof grantExpiry === "string" ? grantExpiry : record(record(connection.config).oauth).expiresAt;
  if (typeof value !== "string") return { expiresAtMs: null, invalid: false };
  const parsed = Date.parse(value), valid = Number.isFinite(parsed);
  return { expiresAtMs: valid ? parsed : null, invalid: !valid };
}
