import {
  randomBytes,
  randomUUID,
  createDecipheriv,
  createHash,
  type DecipherGCM,
} from "node:crypto";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { and, eq, isNull, lte } from "drizzle-orm";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  runtimeBackups,
  runtimeVersionCatalog,
  type Db,
  runtimeCells,
} from "@paperclipai/db";
import type { SaasPlatformConfig } from "../../saas-platform-config.js";
import { conflict, forbidden, notFound } from "../../errors.js";
import { secretService } from "../secrets.js";

export function runtimeBackupService(db: Db, config: SaasPlatformConfig) {
  function clients() {
    if (!config.backups)
      throw conflict("Runtime backup storage is not configured");
    return {
      bucket: config.backups.bucket,
      writer: new S3Client({
        region: config.objects.region,
        endpoint: config.objects.endpoint,
        forcePathStyle: true,
        credentials: config.backups.writeCredentials,
        requestChecksumCalculation: "WHEN_REQUIRED",
      }),
      reader: new S3Client({
        region: config.objects.region,
        endpoint: config.objects.endpoint,
        forcePathStyle: true,
        credentials: config.backups.restoreCredentials,
        responseChecksumValidation: "WHEN_REQUIRED",
      }),
    };
  }
  async function prepare(
    transactionDb: Db,
    cell: typeof runtimeCells.$inferSelect,
    userId: string,
    now: Date,
  ) {
    if (!config.backups)
      throw conflict("Runtime backup storage is not configured");
    const [version] = await transactionDb
      .select()
      .from(runtimeVersionCatalog)
      .where(
        eq(
          runtimeVersionCatalog.imageDigest,
          cell.activeImageDigest ?? cell.desiredImageDigest,
        ),
      )
      .limit(1);
    if (!version) throw conflict("Runtime state format is unknown");
    const id = randomUUID();
    const key = await secretService(transactionDb).create(
      cell.companyId,
      {
        name: "Runtime backup " + id,
        provider: "local_encrypted",
        value: randomBytes(32).toString("hex"),
        description: "Independent runtime backup encryption key",
      },
      { userId },
    );
    const [backup] = await transactionDb
      .insert(runtimeBackups)
      .values({
        id,
        companyId: cell.companyId,
        runtimeCellId: cell.id,
        generation: cell.generation,
        imageDigest: version.imageDigest,
        stateFormat: version.stateFormat,
        objectKey:
          "companies/" +
          cell.companyId +
          "/runtime-backups/" +
          cell.id +
          "/" +
          id +
          ".awb6",
        encryptionKeyRef: key.id,
        retainUntil: new Date(
          now.getTime() + config.runtime.backupRetentionDays * 86400000,
        ),
      })
      .returning();
    return backup!;
  }
  async function get(
    companyId: string,
    backupId: string,
    reader: Pick<Db, "select"> = db,
  ) {
    const [backup] = await reader
      .select()
      .from(runtimeBackups)
      .where(
        and(
          eq(runtimeBackups.id, backupId),
          eq(runtimeBackups.companyId, companyId),
          isNull(runtimeBackups.deletedAt),
        ),
      )
      .limit(1)
      .for("share");
    if (!backup) throw notFound("Runtime backup not found");
    return backup;
  }
  async function command(
    companyId: string,
    cellId: string,
    backupId: string,
    hostId: string,
    type: "backup" | "restore",
    maxBytes: string,
  ) {
    const backup = await get(companyId, backupId);
    if (backup.runtimeCellId !== cellId)
      throw forbidden("Backup runtime scope mismatch");
    if (type === "restore" && backup.status !== "VERIFIED")
      throw conflict("Only verified backups may be restored");
    const { bucket, writer, reader } = clients();
    const key = await secretService(db).resolveSecretValue(
      companyId,
      backup.encryptionKeyRef,
      "latest",
      {
        accessContext: {
          consumerType: "system",
          consumerId: backup.id,
          actorType: "system",
          actorId: "runtime-host:" + hostId,
        },
      },
    );
    const url =
      type === "backup"
        ? await getSignedUrl(
            writer,
            new PutObjectCommand({
              Bucket: bucket,
              Key: backup.objectKey,
              ContentType: "application/octet-stream",
            }),
            { expiresIn: 600 },
          )
        : await getSignedUrl(
            reader,
            new GetObjectCommand({ Bucket: bucket, Key: backup.objectKey }),
            { expiresIn: 600 },
          );
    writer.destroy();
    reader.destroy();
    return {
      id: backup.id,
      companyId,
      cellId,
      generation: backup.generation.toString(),
      imageDigest: backup.imageDigest,
      stateFormat: backup.stateFormat,
      key,
      maxBytes,
      url,
      ...(type === "restore"
        ? {
            sha256: backup.ciphertextSha256,
            bytes: backup.byteSize?.toString(),
          }
        : {}),
    };
  }
  async function verifyOne(now = new Date()) {
    const [backup] = await db
      .select()
      .from(runtimeBackups)
      .where(
        and(
          eq(runtimeBackups.status, "AVAILABLE"),
          lte(runtimeBackups.verificationNotBefore, now),
        ),
      )
      .orderBy(runtimeBackups.createdAt)
      .limit(1);
    if (!backup) return false;
    const { bucket, writer, reader } = clients();
    writer.destroy();
    try {
      if (!backup.byteSize || !backup.ciphertextSha256)
        throw conflict("Backup integrity evidence is missing");
      const head = await reader.send(
        new HeadObjectCommand({ Bucket: bucket, Key: backup.objectKey }),
      );
      if (BigInt(head.ContentLength ?? -1) !== backup.byteSize)
        throw conflict("Backup object length mismatch");
      const key = await secretService(db).resolveSecretValue(
        backup.companyId,
        backup.encryptionKeyRef,
        "latest",
        {
          accessContext: {
            consumerType: "system",
            consumerId: backup.id,
            actorType: "system",
            actorId: "runtime-backup-verification",
          },
        },
      );
      const object = await reader.send(
        new GetObjectCommand({ Bucket: bucket, Key: backup.objectKey }),
      );
      if (!(object.Body instanceof Readable))
        throw conflict("Backup object stream unavailable");
      const context = JSON.stringify({
        format: "aw-state-archive-v1",
        backupId: backup.id,
        companyId: backup.companyId,
        cellId: backup.runtimeCellId,
        generation: backup.generation.toString(),
        imageDigest: backup.imageDigest,
        stateFormat: backup.stateFormat,
      });
      let header = Buffer.alloc(0),
        tail = Buffer.alloc(0),
        size = 0n,
        decipher: DecipherGCM | undefined;
      const hash = createHash("sha256");
      const decrypt = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          try {
            size += BigInt(chunk.length);
            if (size > backup.byteSize!)
              throw conflict("Backup stream exceeded declared length");
            hash.update(chunk);
            if (!decipher) {
              header = Buffer.concat([header, chunk]);
              if (header.length < 16) return callback();
              if (header.subarray(0, 4).toString() !== "AWB6")
                throw conflict("Invalid backup format");
              decipher = createDecipheriv(
                "aes-256-gcm",
                Buffer.from(key, "hex"),
                header.subarray(4, 16),
              );
              decipher.setAAD(Buffer.from(context));
              chunk = header.subarray(16);
              header = Buffer.alloc(0);
            }
            tail = Buffer.concat([tail, chunk]);
            if (tail.length > 16) {
              this.push(decipher.update(tail.subarray(0, tail.length - 16)));
              tail = tail.subarray(tail.length - 16);
            }
            callback();
          } catch (error) {
            callback(error as Error);
          }
        },
        flush(callback) {
          try {
            if (
              !decipher ||
              tail.length !== 16 ||
              size !== backup.byteSize ||
              hash.digest("hex") !== backup.ciphertextSha256
            )
              throw conflict("Backup checksum mismatch");
            decipher.setAuthTag(tail);
            this.push(decipher.final());
            callback();
          } catch (error) {
            callback(error as Error);
          }
        },
      });
      await pipeline(
        object.Body,
        decrypt,
        new Writable({
          write(_chunk, _encoding, callback) {
            callback();
          },
        }),
      );
      await db
        .update(runtimeBackups)
        .set({
          status: "VERIFIED",
          verifiedAt: now,
          verificationAttempts: backup.verificationAttempts + 1,
          verificationErrorCode: null,
        })
        .where(
          and(
            eq(runtimeBackups.id, backup.id),
            eq(runtimeBackups.status, "AVAILABLE"),
          ),
        );
      return true;
    } catch (error) {
      const integrity =
        error instanceof Error &&
        (/^(Backup (integrity evidence is missing|object length mismatch|stream exceeded declared length|checksum mismatch)|Invalid backup format)$/.test(
          error.message,
        ) ||
          ("code" in error && error.code === "ERR_OSSL_BAD_DECRYPT") ||
          error.message.includes("authenticate data"));
      const attempts = backup.verificationAttempts + 1;
      await db
        .update(runtimeBackups)
        .set({
          status: integrity || attempts >= 8 ? "FAILED" : "AVAILABLE",
          verificationAttempts: attempts,
          verificationNotBefore: new Date(
            now.getTime() +
              Math.min(3600000, 30000 * 2 ** backup.verificationAttempts),
          ),
          verificationErrorCode: integrity
            ? "backup_integrity_failed"
            : attempts >= 8
              ? "backup_verification_requires_review"
              : "backup_verification_unavailable",
        })
        .where(
          and(
            eq(runtimeBackups.id, backup.id),
            eq(runtimeBackups.status, "AVAILABLE"),
          ),
        );
      return true;
    } finally {
      reader.destroy();
    }
  }
  async function list(companyId: string, cellId: string) {
    return db
      .select({
        id: runtimeBackups.id,
        generation: runtimeBackups.generation,
        imageDigest: runtimeBackups.imageDigest,
        stateFormat: runtimeBackups.stateFormat,
        status: runtimeBackups.status,
        byteSize: runtimeBackups.byteSize,
        createdAt: runtimeBackups.createdAt,
        verifiedAt: runtimeBackups.verifiedAt,
        verificationErrorCode: runtimeBackups.verificationErrorCode,
        retainUntil: runtimeBackups.retainUntil,
      })
      .from(runtimeBackups)
      .where(
        and(
          eq(runtimeBackups.companyId, companyId),
          eq(runtimeBackups.runtimeCellId, cellId),
          isNull(runtimeBackups.deletedAt),
        ),
      );
  }
  return { prepare, get, command, verifyOne, list };
}
