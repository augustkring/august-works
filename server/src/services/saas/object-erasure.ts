import {
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { and, eq, isNull } from "drizzle-orm";
import {
  applicationStorageObjects,
  runtimeBackups,
  saasRunLogs,
  saasRunLogChunks,
  type Db,
} from "@paperclipai/db";
import type { SaasPlatformConfig } from "../../saas-platform-config.js";
import { conflict } from "../../errors.js";
export function companyObjectErasure(db: Db, config: SaasPlatformConfig) {
  const options = {
    region: config.objects.region,
    endpoint: config.objects.endpoint,
    forcePathStyle: true,
  };
  async function erasePrefix(client: S3Client, bucket: string, prefix: string) {
    let removed = 0;
    for (let page = 0; page < 10000; page++) {
      const versions = await client.send(
        new ListObjectVersionsCommand({
          Bucket: bucket,
          Prefix: prefix,
          MaxKeys: 100,
        }),
      );
      const records = [
        ...(versions.Versions ?? []),
        ...(versions.DeleteMarkers ?? []),
      ];
      if (!records.length) break;
      for (const record of records) {
        if (!record.Key?.startsWith(prefix) || !record.VersionId)
          throw conflict("Object version scope mismatch");
        await client.send(
          new DeleteObjectCommand({
            Bucket: bucket,
            Key: record.Key,
            VersionId: record.VersionId,
          }),
        );
        removed++;
      }
      if (page === 9999)
        throw conflict("Object version erasure ceiling reached");
    }
    // Delete from the first page repeatedly: no cursor can skip keys as earlier objects disappear.
    for (let page = 0; page < 10000; page++) {
      const listed = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          MaxKeys: 100,
        }),
      );
      if (!listed.Contents?.length) return removed;
      for (const item of listed.Contents) {
        if (!item.Key?.startsWith(prefix))
          throw conflict("Object erasure prefix mismatch");
        await client.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: item.Key }),
        );
        removed++;
      }
    }
    throw conflict("Object erasure page ceiling reached");
  }
  function targets(companyId: string) {
    const storagePrefix = (
      process.env.PAPERCLIP_STORAGE_S3_PREFIX ?? ""
    ).replace(/^\/+|\/+$/g, "");
    const logsPrefix = (process.env.RUN_LOG_S3_PREFIX ?? "run-logs").replace(
      /^\/+|\/+$/g,
      "",
    );
    if (!config.objects.exportsBucket || !config.backups)
      throw conflict("Complete company storage targets are required");
    return {
      environment: config.environment,
      endpoint: config.objects.endpoint,
      region: config.objects.region,
      artifacts: {
        bucket: config.objects.bucket,
        prefix: (storagePrefix ? storagePrefix + "/" : "") + companyId + "/",
      },
      runLogs: {
        bucket: process.env.RUN_LOG_S3_BUCKET ?? config.objects.bucket,
        prefix: (logsPrefix ? logsPrefix + "/" : "") + companyId + "/",
      },
      exports: {
        bucket: config.objects.exportsBucket,
        prefix: "companies/" + companyId + "/",
      },
      backups: {
        bucket: config.backups.bucket,
        prefix: "companies/" + companyId + "/runtime-backups/",
      },
    };
  }
  async function erase(
    companyId: string,
    now = new Date(),
    frozenTargets?: unknown,
  ) {
    if (!/^[a-f0-9-]{36}$/.test(companyId))
      throw conflict("Invalid company object scope");
    if (!config.backups)
      throw conflict("Backup retention credentials are required");
    const owned = targets(companyId);
    const uploads = await db
      .select()
      .from(applicationStorageObjects)
      .where(
        and(
          eq(applicationStorageObjects.companyId, companyId),
          eq(applicationStorageObjects.status, "reserved"),
        ),
      );
    if (
      uploads.some(
        (upload) => now.getTime() - upload.createdAt.getTime() < 300000,
      )
    )
      throw conflict(
        "In-flight application uploads must settle before erasure",
      );
    if (
      frozenTargets &&
      JSON.stringify(frozenTargets) !== JSON.stringify(owned)
    )
      throw conflict(
        "Company storage configuration changed; restore the recorded deletion targets before erasure",
      );
    const backups = await db
      .select()
      .from(runtimeBackups)
      .where(
        and(
          eq(runtimeBackups.companyId, companyId),
          isNull(runtimeBackups.deletedAt),
        ),
      );
    if (backups.some((backup) => backup.retainUntil > now))
      throw conflict("Backup retention has not elapsed");
    // Serialize with archive uploads, then fence all future append/flush activity before prefix erasure.
    await db.transaction(async (tx) => {
      const logs = await tx
        .select({ id: saasRunLogs.id })
        .from(saasRunLogs)
        .where(eq(saasRunLogs.companyId, companyId))
        .for("update");
      await tx
        .update(saasRunLogs)
        .set({ erasedAt: now, pendingBytes: 0, sha256: null })
        .where(eq(saasRunLogs.companyId, companyId));
      for (const log of logs)
        await tx
          .update(saasRunLogChunks)
          .set({ ciphertext: null })
          .where(eq(saasRunLogChunks.runId, log.id));
    });
    const client = new S3Client(options),
      retention = new S3Client({
        ...options,
        credentials: config.backups.retentionCredentials,
      });
    try {
      for (const backup of backups) {
        if (
          !backup.objectKey.startsWith(
            "companies/" + companyId + "/runtime-backups/",
          )
        )
          throw conflict("Backup object scope mismatch");
        await erasePrefix(retention, config.backups.bucket, backup.objectKey);
        try {
          await retention.send(
            new HeadObjectCommand({
              Bucket: config.backups.bucket,
              Key: backup.objectKey,
            }),
          );
          throw conflict("Backup erasure is unconfirmed");
        } catch (error) {
          if (
            !(
              error &&
              typeof error === "object" &&
              "$metadata" in error &&
              (error.$metadata as { httpStatusCode?: number })
                .httpStatusCode === 404
            )
          )
            throw error;
        }
        await db
          .update(runtimeBackups)
          .set({ status: "DELETED", deletedAt: now })
          .where(eq(runtimeBackups.id, backup.id));
      }
      const artifacts = await erasePrefix(
        client,
        owned.artifacts.bucket,
        owned.artifacts.prefix,
      );
      const runLogs = await erasePrefix(
        client,
        owned.runLogs.bucket,
        owned.runLogs.prefix,
      );
      const exports = await erasePrefix(
        client,
        owned.exports.bucket,
        owned.exports.prefix,
      );
      // Final scans include delete markers created while removing a current version.
      for (const target of [owned.artifacts, owned.runLogs, owned.exports]) {
        const versions = await client.send(
          new ListObjectVersionsCommand({
            Bucket: target.bucket,
            Prefix: target.prefix,
            MaxKeys: 1,
          }),
        );
        if (versions.Versions?.length || versions.DeleteMarkers?.length)
          throw conflict("Object version erasure is unconfirmed");
      }
      await db
        .update(applicationStorageObjects)
        .set({ status: "deleted", deletedAt: now, updatedAt: now })
        .where(eq(applicationStorageObjects.companyId, companyId));
      return {
        artifacts,
        runLogs,
        exports,
        backups: backups.length,
        verifiedAt: now.toISOString(),
      };
    } finally {
      client.destroy();
      retention.destroy();
    }
  }
  return { erase, targets };
}
