import {
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import {
  activityLog,
  companySecrets,
  runtimeBackups,
  type Db,
} from "@paperclipai/db";
import type { SaasPlatformConfig } from "../../saas-platform-config.js";
import { conflict } from "../../errors.js";
import { secretService } from "../secrets.js";

export interface RetainedBackupObjects {
  remove(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
export function runtimeBackupRetentionObjects(
  config: SaasPlatformConfig,
): RetainedBackupObjects {
  if (!config.backups)
    throw conflict("Backup retention configuration required");
  const bucket = config.backups.bucket;
  const client = () =>
    new S3Client({
      region: config.objects.region,
      endpoint: config.objects.endpoint,
      forcePathStyle: true,
      credentials: config.backups!.retentionCredentials,
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  return {
    async remove(key) {
      const s3 = client();
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), {
          abortSignal: AbortSignal.timeout(30000),
        });
        for (let page = 0; page < 10000; page++) {
          const listing = await s3.send(
            new ListObjectVersionsCommand({
              Bucket: bucket,
              Prefix: key,
              MaxKeys: 100,
            }),
            { abortSignal: AbortSignal.timeout(30000) },
          );
          const versions = [
            ...(listing.Versions ?? []),
            ...(listing.DeleteMarkers ?? []),
          ];
          if (
            versions.some(
              (version) => version.Key !== key || !version.VersionId,
            )
          )
            throw conflict("Backup retention object scope mismatch");
          if (!versions.length) return;
          for (const version of versions)
            await s3.send(
              new DeleteObjectCommand({
                Bucket: bucket,
                Key: key,
                VersionId: version.VersionId,
              }),
              { abortSignal: AbortSignal.timeout(30000) },
            );
        }
        throw conflict("Backup retention erasure ceiling reached");
      } finally {
        s3.destroy();
      }
    },
    async exists(key) {
      const s3 = client();
      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), {
          abortSignal: AbortSignal.timeout(30000),
        });
        return true;
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "$metadata" in error &&
          (error.$metadata as { httpStatusCode?: number }).httpStatusCode ===
            404
        )
          return false;
        throw error;
      } finally {
        s3.destroy();
      }
    },
  };
}
/** Restore selection shares the backup row lock; retention erasure takes its exclusive lock. */
export function runtimeBackupRetention(db: Db, objects: RetainedBackupObjects) {
  async function expireOne(now = new Date()) {
    return db.transaction(async (tx) => {
      const [backup] = await tx
        .select()
        .from(runtimeBackups)
        .where(
          and(
            isNull(runtimeBackups.deletedAt),
            lte(runtimeBackups.retainUntil, now),
            sql`not exists (select 1 from runtime_operations o where o.runtime_cell_id=${runtimeBackups.runtimeCellId}
          and o.status in ('REQUESTED','RUNNING','WAITING_FOR_CAPACITY','NEEDS_RECONCILIATION')
          and o.desired_state->>'backupId'=${runtimeBackups.id}::text)`,
          ),
        )
        .orderBy(runtimeBackups.retainUntil, runtimeBackups.id)
        .limit(1)
        .for("update", { skipLocked: true });
      if (!backup) return false;
      const expected =
        "companies/" +
        backup.companyId +
        "/runtime-backups/" +
        backup.runtimeCellId +
        "/" +
        backup.id +
        ".awb6";
      if (backup.objectKey !== expected)
        throw conflict("Backup retention ownership mismatch");
      // No active restore can be admitted between this lock and the terminal deletion receipt.
      await objects.remove(backup.objectKey);
      if (await objects.exists(backup.objectKey))
        throw conflict("Backup retention erasure is unconfirmed");
      const [key] = await tx
        .select()
        .from(companySecrets)
        .where(
          and(
            eq(companySecrets.id, backup.encryptionKeyRef),
            eq(companySecrets.companyId, backup.companyId),
          ),
        )
        .for("update");
      if (
        key &&
        (key.provider !== "local_encrypted" ||
          key.name !== "Runtime backup " + backup.id)
      )
        throw conflict("Backup encryption key ownership mismatch");
      if (key) await secretService(tx).remove(key.id);
      await tx
        .update(runtimeBackups)
        .set({ status: "DELETED", deletedAt: now, verificationErrorCode: null })
        .where(eq(runtimeBackups.id, backup.id));
      await tx
        .insert(activityLog)
        .values({
          companyId: backup.companyId,
          actorType: "system",
          actorId: "backup-retention",
          action: "runtime.backup_retention_erased",
          entityType: "runtime_backup",
          entityId: backup.id,
          details: {
            generation: backup.generation.toString(),
            retainedUntil: backup.retainUntil.toISOString(),
            ciphertextErased: true,
            encryptionKeyErased: true,
          },
        });
      return true;
    });
  }
  return { expireOne };
}
