import { createHash } from "node:crypto";
import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import {
  companies,
  companyDeletionOperations,
  heartbeatRuns,
  saasRunLogs,
  saasRunLogChunks,
  type Db,
} from "@paperclipai/db";
import { conflict, notFound, unprocessable } from "../../errors.js";
import type { RunLogHandle, RunLogStore } from "../run-log-store.js";
import type { StorageProvider } from "../../storage/types.js";
import { open, seal, sha256 } from "./crypto.js";

const MAX_CHUNK_BYTES = 1024 * 1024,
  MAX_RUN_BYTES = 200 * 1024 * 1024,
  MAX_PENDING_BYTES = 16 * 1024 * 1024;
type Keys = {
  encryptionKey: string;
  keyId: string;
  previousKeys: Record<string, string>;
};
type Chunk = typeof saasRunLogChunks.$inferSelect;
/** Encrypted PG append journal + immutable encrypted S3 archive. No local state or best-effort acknowledgement. */
export function saasRunLogStore(
  db: Db,
  provider: StorageProvider,
  keys: Keys,
  prefix = "run-logs",
): RunLogStore & { flushOne(): Promise<boolean> } {
  if (
    !/^[a-f0-9]{64}$/i.test(keys.encryptionKey) ||
    !keys.keyId ||
    !/^[-a-zA-Z0-9_/]*$/.test(prefix) ||
    prefix.split("/").includes("..")
  )
    throw new Error("Invalid durable run log configuration");
  const keyRing = { ...keys.previousKeys, [keys.keyId]: keys.encryptionKey };
  function context(row: Pick<Chunk, "companyId" | "runId" | "ordinal">) {
    return "aw-run-log:" + row.companyId + ":" + row.runId + ":" + row.ordinal;
  }
  function decrypt(row: Chunk, ciphertext: string) {
    const key = keyRing[row.keyId];
    if (!key) throw conflict("Run log encryption key is unavailable");
    const value = open<string>(ciphertext, key, context(row));
    if (typeof value !== "string") throw conflict("Invalid run log archive");
    const data = Buffer.from(value, "utf8");
    if (data.length !== row.byteSize || sha256(data) !== row.sha256)
      throw conflict("Run log integrity check failed");
    return data;
  }
  async function load(row: Chunk) {
    if (row.ciphertext) return decrypt(row, row.ciphertext);
    const object = await provider.getObject({ objectKey: row.objectKey });
    let size = 0;
    const parts: Buffer[] = [];
    const max = MAX_CHUNK_BYTES * 2 + 1024;
    for await (const value of object.stream) {
      const part = Buffer.from(value);
      size += part.length;
      if (size > max) {
        object.stream.destroy();
        throw conflict("Run log archive is too large");
      }
      parts.push(part);
    }
    const body = Buffer.concat(parts);
    if (sha256(body) !== row.objectSha256)
      throw conflict("Run log archive checksum mismatch");
    return decrypt(row, body.toString("utf8"));
  }
  async function locked(
    handle: RunLogHandle,
    reader: Pick<Db, "select"> = db,
    mode: "update" | "share" = "update",
  ) {
    if (handle.store !== "local_file") throw notFound("Run log not found");
    const [manifest] = await reader
      .select()
      .from(saasRunLogs)
      .where(eq(saasRunLogs.logRef, handle.logRef))
      .for(mode)
      .limit(1);
    if (!manifest || manifest.erasedAt) throw notFound("Run log not found");
    return manifest;
  }
  async function flushOne() {
    return db.transaction(async (tx) => {
      const [manifest] = await tx
        .select()
        .from(saasRunLogs)
        .where(
          and(gt(saasRunLogs.pendingBytes, 0), isNull(saasRunLogs.erasedAt)),
        )
        .orderBy(saasRunLogs.createdAt)
        .for("update", { skipLocked: true })
        .limit(1);
      if (!manifest) return false;
      const chunks = await tx
        .select()
        .from(saasRunLogChunks)
        .where(
          and(
            eq(saasRunLogChunks.runId, manifest.id),
            isNull(saasRunLogChunks.archivedAt),
          ),
        )
        .orderBy(saasRunLogChunks.ordinal)
        .limit(16);
      for (const row of chunks) {
        if (!row.ciphertext) throw conflict("Pending run log buffer missing");
        const body = Buffer.from(row.ciphertext);
        // The same persisted ciphertext, object key and hash survive an unknown PUT outcome.
        await provider.putObject({
          objectKey: row.objectKey,
          body,
          contentLength: body.length,
          contentType: "application/octet-stream",
        });
        const archived = { ...row, ciphertext: null };
        await load(archived); // verify actual readable authenticated bytes before dropping the PG buffer
        await tx
          .update(saasRunLogChunks)
          .set({ ciphertext: null, archivedAt: new Date() })
          .where(eq(saasRunLogChunks.id, row.id));
        await tx
          .update(saasRunLogs)
          .set({
            pendingBytes: sql`${saasRunLogs.pendingBytes}-${row.byteSize}`,
          })
          .where(eq(saasRunLogs.id, manifest.id));
      }
      return true;
    });
  }
  return {
    async begin(input) {
      const logRef =
        input.companyId + "/" + input.agentId + "/" + input.runId + ".ndjson";
      return db.transaction(async (tx) => {
        const [company] = await tx
          .select({ status: companies.status })
          .from(companies)
          .where(eq(companies.id, input.companyId))
          .for("share")
          .limit(1);
        const [deletion] = await tx
          .select({ id: companyDeletionOperations.id })
          .from(companyDeletionOperations)
          .where(eq(companyDeletionOperations.companyId, input.companyId))
          .limit(1);
        if (!company || company.status !== "active" || deletion)
          throw notFound("Run not found");
        const [run] = await tx
          .select({ id: heartbeatRuns.id })
          .from(heartbeatRuns)
          .where(
            and(
              eq(heartbeatRuns.id, input.runId),
              eq(heartbeatRuns.companyId, input.companyId),
              eq(heartbeatRuns.agentId, input.agentId),
            ),
          )
          .limit(1);
        if (!run) throw notFound("Run not found");
        await tx
          .insert(saasRunLogs)
          .values({ id: input.runId, ...input, logRef })
          .onConflictDoNothing();
        await locked({ store: "local_file", logRef }, tx);
        return { store: "local_file" as const, logRef };
      });
    },
    async append(handle, event) {
      const content = JSON.stringify(event) + "\n",
        data = Buffer.from(content),
        hash = sha256(data);
      if (
        !data.length ||
        data.length > MAX_CHUNK_BYTES ||
        (event.seq !== undefined &&
          (!Number.isSafeInteger(event.seq) || event.seq < 1))
      )
        throw unprocessable("Run log chunk exceeds its limit");
      return db.transaction(async (tx) => {
        const manifest = await locked(handle, tx);
        if (event.seq !== undefined) {
          const [existing] = await tx
            .select()
            .from(saasRunLogChunks)
            .where(
              and(
                eq(saasRunLogChunks.runId, manifest.id),
                eq(saasRunLogChunks.eventSeq, event.seq),
              ),
            )
            .limit(1);
          if (existing) {
            if (existing.sha256 !== hash)
              throw conflict("Run log event sequence has different content");
            return 0;
          }
        }
        if (manifest.finalizedAt) throw conflict("Run log is finalized");
        if (
          manifest.byteSize + data.length > MAX_RUN_BYTES ||
          manifest.pendingBytes + data.length > MAX_PENDING_BYTES ||
          manifest.nextOrdinal > 100000
        )
          throw conflict(
            "Durable run log capacity reached; restore archive delivery before continuing",
          );
        const scope = {
          companyId: manifest.companyId,
          runId: manifest.id,
          ordinal: manifest.nextOrdinal,
        };
        const ciphertext = seal(content, keys.encryptionKey, context(scope)),
          objectSha256 = sha256(ciphertext);
        await tx
          .insert(saasRunLogChunks)
          .values({
            ...scope,
            eventSeq: event.seq,
            byteOffset: manifest.byteSize,
            byteSize: data.length,
            sha256: hash,
            keyId: keys.keyId,
            ciphertext,
            objectSha256,
            objectKey: [
              prefix,
              manifest.companyId,
              manifest.agentId,
              manifest.id,
              manifest.nextOrdinal + "-" + objectSha256 + ".sealed",
            ]
              .filter(Boolean)
              .join("/"),
          });
        await tx
          .update(saasRunLogs)
          .set({
            byteSize: manifest.byteSize + data.length,
            pendingBytes: manifest.pendingBytes + data.length,
            nextOrdinal: manifest.nextOrdinal + 1,
          })
          .where(eq(saasRunLogs.id, manifest.id));
        return data.length;
      });
    },
    async read(handle, opts) {
      const offset = opts?.offset ?? 0,
        limit = opts?.limitBytes ?? 256000;
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > MAX_CHUNK_BYTES
      )
        throw unprocessable("Invalid run log range");
      return db.transaction(async (tx) => {
        const manifest = await locked(handle, tx, "share"),
          start = Math.min(offset, manifest.byteSize),
          end = Math.min(start + limit, manifest.byteSize);
        const chunks = await tx
          .select()
          .from(saasRunLogChunks)
          .where(
            and(
              eq(saasRunLogChunks.runId, manifest.id),
              lt(saasRunLogChunks.byteOffset, end),
              sql`${saasRunLogChunks.byteOffset}+${saasRunLogChunks.byteSize}>${start}`,
            ),
          )
          .orderBy(saasRunLogChunks.ordinal);
        const parts: Buffer[] = [];
        for (const row of chunks) {
          const data = await load(row);
          parts.push(
            data.subarray(
              Math.max(0, start - row.byteOffset),
              Math.min(row.byteSize, end - row.byteOffset),
            ),
          );
        }
        const body = Buffer.concat(parts);
        if (body.length !== end - start)
          throw conflict("Run log has a missing durable chunk");
        return { content: body.toString("utf8"), nextOffset: end };
      });
    },
    async finalize(handle) {
      return db.transaction(async (tx) => {
        const manifest = await locked(handle, tx);
        if (manifest.finalizedAt && manifest.sha256)
          return {
            bytes: manifest.byteSize,
            sha256: manifest.sha256,
            compressed: false,
          };
        const hash = createHash("sha256");
        // Cursor-sized pages bound memory even at the per-run limit. The manifest lock excludes late appends.
        for (let ordinal = 1; ordinal < manifest.nextOrdinal; ) {
          const rows = await tx
            .select()
            .from(saasRunLogChunks)
            .where(
              and(
                eq(saasRunLogChunks.runId, manifest.id),
                gt(saasRunLogChunks.ordinal, ordinal - 1),
              ),
            )
            .orderBy(saasRunLogChunks.ordinal)
            .limit(64);
          if (!rows.length)
            throw conflict("Run log has a missing durable chunk");
          for (const row of rows) {
            if (row.ordinal !== ordinal++)
              throw conflict("Run log has a missing durable chunk");
            hash.update(await load(row));
          }
        }
        const digest = hash.digest("hex");
        await tx
          .update(saasRunLogs)
          .set({ finalizedAt: new Date(), sha256: digest })
          .where(eq(saasRunLogs.id, manifest.id));
        return { bytes: manifest.byteSize, sha256: digest, compressed: false };
      });
    },
    async erase(handle) {
      await db.transaction(async (tx) => {
        const [manifest] = await tx
          .select()
          .from(saasRunLogs)
          .where(eq(saasRunLogs.logRef, handle.logRef))
          .for("update")
          .limit(1);
        if (!manifest) return;
        await tx
          .update(saasRunLogs)
          .set({
            erasedAt: manifest.erasedAt ?? new Date(),
            pendingBytes: 0,
            sha256: null,
          })
          .where(eq(saasRunLogs.id, manifest.id));
        await tx
          .update(saasRunLogChunks)
          .set({ ciphertext: null })
          .where(eq(saasRunLogChunks.runId, manifest.id));
      });
      const rows = await db
        .select({ objectKey: saasRunLogChunks.objectKey })
        .from(saasRunLogChunks)
        .innerJoin(saasRunLogs, eq(saasRunLogs.id, saasRunLogChunks.runId))
        .where(eq(saasRunLogs.logRef, handle.logRef));
      for (const row of rows) {
        await provider.deleteObject({ objectKey: row.objectKey });
        if ((await provider.headObject({ objectKey: row.objectKey })).exists)
          throw conflict("Run log erasure awaits object storage confirmation");
      }
    },
    flushOne,
    async flushInflightMirrors() {
      for (let count = 0; count < 1000; count++)
        if (!(await flushOne())) return;
      throw conflict("Run log archive drain exceeded its bounded work limit");
    },
  };
}
