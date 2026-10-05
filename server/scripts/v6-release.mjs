// Run from a digest-pinned control image with the tsx loader. Migration is an explicit operator job.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { inspectMigrations, applyPendingMigrations } from "@paperclipai/db";
import { v6FeatureFlagsSchema } from "@paperclipai/shared";
import { assertApplicationDatabaseRole } from "../../deploy/v6/database-role-policy.mjs";
import {
  assertMigrationBackup,
  releaseConfigHash,
  validateReleaseIdentity,
} from "../../deploy/v6/release-policy.mjs";

const env = process.env;
function required(name) {
  if (!env[name]) throw Error("Missing release configuration: " + name);
  return env[name];
}
const identity = validateReleaseIdentity(
  {
    environment: required("AW_PLATFORM_ENV"),
    sourceSha: required("AW_DEPLOYMENT_SOURCE_SHA"),
    imageDigest: required("AW_DEPLOYMENT_IMAGE_DIGEST"),
    operator: required("AW_RELEASE_OPERATOR"),
  },
  JSON.parse(
    await readFile(new URL("../dist/build-info.json", import.meta.url), "utf8"),
  ),
);
function connection(name) {
  const value = required(name),
    url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.searchParams.get("sslmode") !== "verify-full"
  )
    throw Error("Verified PostgreSQL transport required");
  return { value, url };
}
const application = connection("DATABASE_URL"),
  mode = process.argv[2];
if (!["preflight", "migrate", "record"].includes(mode))
  throw Error("Use preflight, migrate or record");
const applicationSql = postgres(application.value, {
  max: 1,
  connect_timeout: 15,
});
async function appPosture() {
  await assertApplicationDatabaseRole(applicationSql);
  const [table] =
    await applicationSql`select to_regclass('public.instance_settings') is not null as present`;
  if (table.present) {
    const [settings] =
      await applicationSql`select general->'awV6RestoreQuarantine' as quarantine from instance_settings where singleton_key='default'`;
    if (settings?.quarantine != null)
      throw Error("Restored database remains quarantined");
  }
}
async function verifiedBackup(state) {
  const receipt = JSON.parse(
    await readFile(required("AW_PRE_MIGRATION_BACKUP_RECEIPT"), "utf8"),
  );
  assertMigrationBackup(
    receipt,
    identity.environment,
    state.appliedMigrations.at(-1) ?? "empty",
  );
  const endpoint = new URL(required("AW_DB_BACKUP_S3_ENDPOINT"));
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password)
    throw Error("HTTPS backup object endpoint required");
  const client = new S3Client({
    endpoint: endpoint.href,
    region: "europe-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: required("AW_DB_RESTORE_ACCESS_KEY_ID"),
      secretAccessKey: required("AW_DB_RESTORE_SECRET_ACCESS_KEY"),
    },
  });
  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: required("AW_DB_BACKUP_BUCKET"),
        Key: receipt.objectKey,
      }),
      { abortSignal: AbortSignal.timeout(1200000) },
    );
    if (response.ContentLength !== receipt.byteSize || !response.Body)
      throw Error("Pre-migration backup size mismatch");
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of response.Body) {
      bytes += chunk.length;
      if (bytes > receipt.byteSize) throw Error("Backup size exceeded");
      hash.update(chunk);
    }
    if (
      bytes !== receipt.byteSize ||
      hash.digest("hex") !== receipt.ciphertextSha256
    )
      throw Error("Pre-migration backup integrity mismatch");
  } finally {
    client.destroy();
  }
}
try {
  await appPosture();
  if (mode === "migrate") {
    const migrator = connection("AW_DB_MIGRATOR_URL");
    if (
      migrator.url.username === application.url.username ||
      ["hostname", "port", "pathname"].some(
        (field) => migrator.url[field] !== application.url[field],
      )
    )
      throw Error("Dedicated migrator for the same database required");
    const sql = postgres(migrator.value, { max: 1, connect_timeout: 15 });
    try {
      const [lock] =
        await sql`select pg_try_advisory_lock(hashtextextended('aw-v6-release',0)) as acquired`;
      if (!lock.acquired)
        throw Error("Another migration job owns the release lock");
      const state = await inspectMigrations(migrator.value);
      if (state.status !== "upToDate") {
        if (state.reason === "no-migration-journal-non-empty-db")
          throw Error(
            "Untracked existing schema requires reviewed manual reconciliation",
          );
        if (state.tableCount > 0) await verifiedBackup(state);
        await applyPendingMigrations(migrator.value);
      }
      process.stdout.write(
        "Operator migration finished. Apply the DML and backup grants before application startup.\n",
      );
    } finally {
      await sql.end();
    }
  } else {
    const state = await inspectMigrations(application.value);
    if (state.status !== "upToDate") throw Error("Application schema is stale");
    const [settings] =
      await applicationSql`select experimental from instance_settings limit 1`;
    const configHash = createHash("sha256")
      .update(
        JSON.stringify({
          publicConfigHash: releaseConfigHash(env),
          flags: v6FeatureFlagsSchema.parse(settings?.experimental ?? {}),
        }),
      )
      .digest("hex");
    if (mode === "record")
      await applicationSql`insert into deployment_records(source_sha,image_digest,schema_version,config_hash,operator,environment,verification_result) values(${identity.sourceSha},${identity.imageDigest},${state.appliedMigrations.at(-1) ?? "empty"},${configHash},${identity.operator},${identity.environment},'preflight_passed')`;
    process.stdout.write(
      mode === "record"
        ? "Deployment evidence recorded. Browser and provider acceptance remains separate.\n"
        : "Release preflight passed.\n",
    );
  }
} finally {
  await applicationSql.end();
}
