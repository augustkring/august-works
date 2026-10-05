import { createHash } from "node:crypto";

export function validateReleaseIdentity(value, stamp) {
  if (
    !["staging", "production"].includes(value.environment) ||
    !/^[a-f0-9]{40}$/.test(value.sourceSha ?? "") ||
    !/^sha256:[a-f0-9]{64}$/.test(value.imageDigest ?? "") ||
    stamp?.commit !== value.sourceSha ||
    typeof value.operator !== "string" ||
    !value.operator.trim() ||
    value.operator.length > 200
  )
    throw Error("Release identity does not match the built image");
  return value;
}
export function assertMigrationBackup(
  receipt,
  environment,
  currentSchema,
  now = Date.now(),
) {
  const verifiedAt = Date.parse(receipt?.verifiedAt),
    createdAt = Date.parse(receipt?.metadata?.createdAt);
  if (
    receipt?.metadata?.environment !== environment ||
    receipt.metadata.schemaVersion !== currentSchema ||
    !Number.isFinite(createdAt) ||
    !Number.isFinite(verifiedAt) ||
    verifiedAt < createdAt ||
    createdAt < now - 3600000 ||
    verifiedAt > now + 60000 ||
    !/^[a-f0-9]{64}$/.test(receipt.ciphertextSha256 ?? "") ||
    !Number.isSafeInteger(receipt.byteSize) ||
    receipt.byteSize < 40 ||
    typeof receipt.objectKey !== "string" ||
    !receipt.objectKey.startsWith("database/" + environment + "/") ||
    !receipt.objectKey.endsWith(".awd6")
  )
    throw Error(
      "A recent verified encrypted backup of the current schema is required",
    );
}
/** Hash only public deployment settings. Credentials and their hashes never enter the deployment record. */
export function releaseConfigHash(env) {
  const fields = [
    "AW_DEPLOYMENT_PROFILE",
    "AW_PLATFORM_ENV",
    "AW_PUBLIC_APP_ORIGIN",
    "AW_ALLOWED_APP_ORIGINS",
    "AW_LEGACY_APP_ORIGINS",
    "TRUST_PROXY",
    "HOST",
    "PORT",
    "PAPERCLIP_STORAGE_PROVIDER",
    "PAPERCLIP_STORAGE_S3_REGION",
    "PAPERCLIP_STORAGE_S3_BUCKET",
    "PAPERCLIP_STORAGE_S3_ENDPOINT",
    "AW_EXPORT_BUCKET",
    "AW_RUNTIME_BACKUP_BUCKET",
    "RUN_LOG_S3_BUCKET",
    "RUN_LOG_S3_REGION",
    "RUN_LOG_S3_ENDPOINT",
    "MAILGUN_REGION",
    "MAILGUN_DOMAIN",
    "PADDLE_ENVIRONMENT",
    "RUNTIME_CONTROL_REGION",
    "RUNTIME_CONTROL_NETWORK_ID",
    "RUNTIME_CONTROL_HOST_PLAN",
    "RUNTIME_CONTROL_HOST_AGENT_IMAGE",
    "RUNTIME_CONTROL_MAX_HOSTS",
    "RUNTIME_CONTROL_MAX_CREATES_PER_HOUR",
    "RUNTIME_CONTROL_MAX_ESTIMATED_MONTHLY_EUR_MINOR",
  ];
  return createHash("sha256")
    .update(
      JSON.stringify(
        Object.fromEntries(fields.map((field) => [field, env[field] ?? null])),
      ),
    )
    .digest("hex");
}
