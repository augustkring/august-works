import { createHash, createHmac, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { once } from "node:events";
import postgres from "postgres";
import { inspectMigrations } from "@paperclipai/db";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { authenticateDeletionLedger } from "../../deploy/v6/deletion-ledger.mjs";
import {
  authenticateDatabaseArchive,
  encryptDatabaseArchive,
} from "../../deploy/v6/database-archive.mjs";

const env = process.env;
function required(name) {
  if (!env[name]) throw Error("Missing operator configuration: " + name);
  return env[name];
}
const environment = required("AW_PLATFORM_ENV");
if (!["staging", "production"].includes(environment))
  throw Error("Invalid backup environment");
const directory = resolve(required("AW_DB_BACKUP_DIR"));
await mkdir(directory, { recursive: true, mode: 0o700 });
if ((await stat(directory)).mode & 0o077)
  throw Error("Database backup directory must be private");
const keyId = required("AW_DB_BACKUP_KEY_ID"),
  key = required("AW_DB_BACKUP_ENCRYPTION_KEY");
if (!/^[a-f0-9]{64}$/i.test(key) || key === env.PAPERCLIP_SECRETS_MASTER_KEY)
  throw Error("Independent database archive key required");
const keys = {
  ...JSON.parse(env.AW_DB_BACKUP_PREVIOUS_KEYS ?? "{}"),
  [keyId]: key,
};
const mode = process.argv[2];
const maxBytes = Number(env.AW_DB_BACKUP_MAX_BYTES ?? 34359738368);
if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > 34359738368)
  throw Error("Invalid database archive size ceiling");
async function atomicJson(file, data) {
  const handle = await open(file + ".partial", "w", 0o600);
  try {
    await handle.writeFile(JSON.stringify(data));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(file + ".partial", file);
  const parent = await open(resolve(file, ".."), "r");
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
}
function databaseEnvironment(value, quarantine = false) {
  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    (!quarantine && url.searchParams.get("sslmode") !== "verify-full")
  )
    throw Error("Verified PostgreSQL transport required");
  if (
    quarantine &&
    (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      !/^\/aw_restore_[a-z0-9_]+$/.test(url.pathname) ||
      value === env.AW_DB_BACKUP_DATABASE_URL)
  )
    throw Error("Restore requires an isolated local aw_restore_ database");
  return {
    PATH: env.PATH,
    LANG: "C",
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: quarantine ? "disable" : "verify-full",
    ...(env.PGSSLROOTCERT ? { PGSSLROOTCERT: env.PGSSLROOTCERT } : {}),
    PGCONNECT_TIMEOUT: "15",
  };
}
function processTool(command, args, credentials) {
  const child = spawn(command, args, {
    env: credentials,
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 1200000,
  });
  const completion = once(child, "close").then(([code]) => {
    if (code !== 0) throw Error(command + " failed");
  });
  // Attach the rejection handler immediately while the dump pipeline consumes stdout.
  completion.catch(() => {});
  return { child, completion };
}
function s3() {
  const endpoint = new URL(required("AW_DB_BACKUP_S3_ENDPOINT"));
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password)
    throw Error("HTTPS backup object endpoint required");
  return new S3Client({
    region: "europe-1",
    endpoint: endpoint.href,
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: required("AW_DB_BACKUP_ACCESS_KEY_ID"),
      secretAccessKey: required("AW_DB_BACKUP_SECRET_ACCESS_KEY"),
    },
  });
}
async function verifyRemote(client, bucket, objectKey, evidence) {
  const response = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
    { abortSignal: AbortSignal.timeout(1200000) },
  );
  if (response.ContentLength !== evidence.byteSize || !response.Body)
    throw Error("Backup object size mismatch");
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of response.Body) {
    bytes += chunk.length;
    if (bytes > evidence.byteSize)
      throw Error("Backup object exceeded size bound");
    hash.update(chunk);
  }
  if (
    bytes !== evidence.byteSize ||
    hash.digest("hex") !== evidence.ciphertextSha256
  )
    throw Error("Backup object integrity mismatch");
}
if (mode === "backup") {
  const pending = join(directory, "pending.json");
  let evidence;
  try {
    evidence = JSON.parse(await readFile(pending, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!evidence) {
    databaseEnvironment(required("AW_DB_BACKUP_DATABASE_URL"));
    const migration = await inspectMigrations(env.AW_DB_BACKUP_DATABASE_URL);
    const schemaVersion = migration.appliedMigrations.at(-1);
    if (!schemaVersion)
      throw Error("Tracked database schema required for backup");
    const metadata = {
      format: "aw-database-archive-v1",
      id: randomUUID(),
      environment,
      sourceSha: required("AW_DEPLOYMENT_SOURCE_SHA"),
      schemaVersion,
      keyId,
      createdAt: new Date().toISOString(),
    };
    const file = join(directory, metadata.id + ".awd6");
    const { child, completion } = processTool(
      "pg_dump",
      ["--format=custom", "--no-owner", "--no-privileges"],
      databaseEnvironment(required("AW_DB_BACKUP_DATABASE_URL")),
    );
    try {
      evidence = {
        ...(await encryptDatabaseArchive(
          child.stdout,
          file,
          metadata,
          key,
          maxBytes,
        )),
        file,
      };
      await completion;
    } catch (error) {
      child.kill("SIGTERM");
      await completion.catch(() => {});
      await rm(file, { force: true });
      throw error;
    }
    await atomicJson(pending, evidence);
  }
  if (
    evidence.metadata.environment !== environment ||
    resolve(evidence.file) !== join(directory, evidence.metadata.id + ".awd6")
  )
    throw Error("Pending backup ownership mismatch");
  const client = s3(),
    bucket = required("AW_DB_BACKUP_BUCKET"),
    objectKey =
      "database/" + environment + "/" + evidence.metadata.id + ".awd6";
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        Body: createReadStream(evidence.file),
        ContentLength: evidence.byteSize,
        ContentType: "application/octet-stream",
        Metadata: {
          sha256: evidence.ciphertextSha256,
          "key-id": evidence.metadata.keyId,
        },
      }),
      { abortSignal: AbortSignal.timeout(1200000) },
    );
    // Use the separate read identity for verification. The writer remains put-only.
    client.destroy();
    env.AW_DB_BACKUP_ACCESS_KEY_ID = required("AW_DB_RESTORE_ACCESS_KEY_ID");
    env.AW_DB_BACKUP_SECRET_ACCESS_KEY = required(
      "AW_DB_RESTORE_SECRET_ACCESS_KEY",
    );
    const reader = s3();
    try {
      await verifyRemote(reader, bucket, objectKey, evidence);
    } finally {
      reader.destroy();
    }
    await atomicJson(join(directory, "last-success.json"), {
      ...evidence,
      file: undefined,
      objectKey,
      verifiedAt: new Date().toISOString(),
    });
    await rm(pending);
    await rm(evidence.file);
    process.stdout.write("Encrypted database backup uploaded and verified.\n");
  } finally {
    client.destroy();
  }
} else if (mode === "export-ledger") {
  const ledgerKey = required("AW_RESTORE_LEDGER_SIGNING_KEY");
  if (!/^[a-f0-9]{64}$/i.test(ledgerKey) || ledgerKey === key)
    throw Error("Independent deletion ledger signing key required");
  databaseEnvironment(required("AW_DB_BACKUP_DATABASE_URL"));
  const sql = postgres(env.AW_DB_BACKUP_DATABASE_URL, { max: 1 });
  try {
    const payload = await sql.begin(
      "isolation level repeatable read read only",
      async (tx) => {
        const [snapshot] = await tx`select now() as exported_at`;
        return {
          environment,
          exportedAt: snapshot.exported_at.toISOString(),
          companies:
            await tx`select company_id from company_deletion_operations limit 100001`,
          memory:
            await tx`select company_id,key,kind,record_id,deleted_at from memory_deletion_markers limit 100001`,
          identityHomes:
            await tx`select id,home_company_id from agent_identities limit 100001`,
          users:
            await tx`select id,user_id,created_at from account_deletion_operations limit 100001`,
        };
      },
    );
    if (
      payload.companies.length +
        payload.memory.length +
        payload.identityHomes.length +
        payload.users.length >
      100000
    )
      throw Error(
        "Deletion ledger requires partitioned export beyond this bound",
      );
    const encoded = JSON.stringify(payload),
      signature = createHmac("sha256", Buffer.from(ledgerKey, "hex"))
        .update(encoded)
        .digest("hex");
    await atomicJson(resolve(required("AW_RESTORE_LEDGER_FILE")), {
      payload: encoded,
      signature,
    });
    const ledgerBytes = Buffer.from(
      JSON.stringify({ payload: encoded, signature }),
    );
    if (ledgerBytes.length > 17 * 1024 ** 2)
      throw Error("Deletion ledger exceeds archive bound");
    const objectKey =
      "deletion-ledgers/" +
      environment +
      "/" +
      payload.exportedAt.replaceAll(":", "-") +
      "-" +
      randomUUID() +
      ".json";
    const latestKey = "deletion-ledgers/" + environment + "/latest.json",
      bucket = required("AW_DB_BACKUP_BUCKET");
    const writer = s3();
    try {
      for (const destination of [objectKey, latestKey])
        await writer.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: destination,
            Body: ledgerBytes,
            ContentLength: ledgerBytes.length,
            ContentType: "application/json",
          }),
          { abortSignal: AbortSignal.timeout(30000) },
        );
    } finally {
      writer.destroy();
    }
    env.AW_DB_BACKUP_ACCESS_KEY_ID = required("AW_DB_RESTORE_ACCESS_KEY_ID");
    env.AW_DB_BACKUP_SECRET_ACCESS_KEY = required(
      "AW_DB_RESTORE_SECRET_ACCESS_KEY",
    );
    const reader = s3(),
      ciphertextSha256 = createHash("sha256").update(ledgerBytes).digest("hex");
    try {
      await verifyRemote(reader, bucket, latestKey, {
        byteSize: ledgerBytes.length,
        ciphertextSha256,
      });
    } finally {
      reader.destroy();
    }
    await atomicJson(join(directory, "ledger-last-success.json"), {
      objectKey,
      latestKey,
      exportedAt: payload.exportedAt,
      verifiedAt: new Date().toISOString(),
      sha256: ciphertextSha256,
    });
    process.stdout.write(
      "Signed deletion ledger exported and verified in independent object storage.\n",
    );
  } finally {
    await sql.end();
  }
} else if (mode === "fetch-ledger") {
  env.AW_DB_BACKUP_ACCESS_KEY_ID = required("AW_DB_RESTORE_ACCESS_KEY_ID");
  env.AW_DB_BACKUP_SECRET_ACCESS_KEY = required(
    "AW_DB_RESTORE_SECRET_ACCESS_KEY",
  );
  const reader = s3();
  try {
    const response = await reader.send(
      new GetObjectCommand({
        Bucket: required("AW_DB_BACKUP_BUCKET"),
        Key: "deletion-ledgers/" + environment + "/latest.json",
      }),
      { abortSignal: AbortSignal.timeout(30000) },
    );
    if (
      !response.Body ||
      !Number.isSafeInteger(response.ContentLength) ||
      response.ContentLength > 17 * 1024 ** 2
    )
      throw Error("Bounded deletion ledger object required");
    const chunks = [];
    let bytes = 0;
    const deadline = setTimeout(
      () =>
        response.Body.destroy(Error("Deletion ledger read deadline exceeded")),
      30000,
    );
    try {
      for await (const chunk of response.Body) {
        bytes += chunk.length;
        if (bytes > 17 * 1024 ** 2)
          throw Error("Deletion ledger exceeded limit");
        chunks.push(chunk);
      }
    } finally {
      clearTimeout(deadline);
      response.Body.destroy();
    }
    if (bytes !== response.ContentLength)
      throw Error("Deletion ledger size mismatch");
    const envelope = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    authenticateDeletionLedger(
      envelope,
      required("AW_RESTORE_LEDGER_SIGNING_KEY"),
      environment,
    );
    await atomicJson(resolve(required("AW_RESTORE_LEDGER_FILE")), envelope);
    process.stdout.write(
      "Independent signed deletion ledger fetched and authenticated. Recovery admission remains a separate qualification.\n",
    );
  } finally {
    reader.destroy();
  }
} else if (mode === "restore-quarantine") {
  const target = required("AW_QUARANTINE_DATABASE_URL"),
    credentials = databaseEnvironment(target, true);
  const archive = resolve(required("AW_DB_RESTORE_ARCHIVE"));
  const ledgerFile = required("AW_RESTORE_LEDGER_FILE");
  if ((await stat(ledgerFile)).size > 17 * 1024 ** 2)
    throw Error("Deletion ledger file exceeds limit");
  const ledger = authenticateDeletionLedger(
    JSON.parse(await readFile(ledgerFile, "utf8")),
    required("AW_RESTORE_LEDGER_SIGNING_KEY"),
    environment,
  );
  const dump = join(directory, randomUUID() + ".dump");
  const sql = postgres(target, { max: 1 });
  let closeRestored;
  try {
    const [existing] =
      await sql`select count(*)::int as count from pg_tables where schemaname in ('public','drizzle')`;
    if (existing.count) throw Error("Quarantine restore target must be empty");
    const verified = await authenticateDatabaseArchive(archive, dump, keys, {
      environment,
      maxBytes,
    });
    if (Date.parse(ledger.exportedAt) < Date.parse(verified.metadata.createdAt))
      throw Error("Deletion ledger predates database archive");
    const { completion } = processTool(
      "pg_restore",
      [
        "--no-owner",
        "--no-privileges",
        "--exit-on-error",
        "--dbname=" + credentials.PGDATABASE,
        dump,
      ],
      credentials,
    );
    await completion;
    // No application or provider workers start in quarantine. Migrate the isolated copy, revoke effects, replay erasures.
    const [
      { createDb, closeRegisteredClients },
      { prepareRestoredQuarantine },
    ] = await Promise.all([
      import("@paperclipai/db"),
      import("../dist/services/saas/quarantine.js"),
    ]);
    const restored = createDb(target);
    closeRestored = () => closeRegisteredClients(target);
    await prepareRestoredQuarantine(restored, target, ledger);
    await closeRegisteredClients(target);
    process.stdout.write(
      "Database restored to quarantine. Credentials revoked and deletion ledger replayed. Application startup remains prohibited.\n",
    );
  } finally {
    await closeRestored?.();
    await sql.end();
    await rm(dump, { force: true });
  }
} else
  throw Error("Use backup, export-ledger, fetch-ledger or restore-quarantine");
