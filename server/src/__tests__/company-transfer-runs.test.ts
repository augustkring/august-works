import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companies, companyTransferRuns, createDb, projects } from "@paperclipai/db";
import { sha256HexOfBytes } from "@paperclipai/shared/portability-hash";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import {
  companyTransferRunService,
  type CompanyTransferPartsIndex,
} from "../services/company-transfer-runs.js";
import { companyExportTransferService } from "../services/company-export-transfers.js";
import { createStorageService } from "../storage/service.js";
import type { StorageProvider } from "../storage/types.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Manifest-shaped fixture: the ledger only cares about an idempotency key and
// part names, so the fixture is built inline rather than through any container
// packer. Distinct content per call: identical content intentionally derives
// the same idempotency key, which would make separate tests resume each
// other's runs.
let manifestSeq = 0;
function demoManifest(): CompanyTransferPartsIndex & { idempotencyKey: string } {
  manifestSeq += 1;
  return {
    idempotencyKey: sha256HexOfBytes(Buffer.from(`transfer-run-fixture-${manifestSeq}`)),
    chunks: [{ name: "chunks/0000.json.gz" }, { name: "chunks/0001.json.gz" }],
    blobs: [{ name: `blobs/${sha256HexOfBytes(pngBytes)}` }],
  };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describeEmbeddedPostgres("companyTransferRunService", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db!: ReturnType<typeof createDb>;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-transfer-runs-");
    db = createDb(tempDb.connectionString);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("creates a run, records parts idempotently, and resumes from the remainder", async () => {
    const manifest = demoManifest();
    const created = await companyTransferRunService.resumeOrCreate(db, {
      direction: "import",
      actorKey: "user:alice",
      idempotencyKey: manifest.idempotencyKey,
      containerRef: { kind: "zip-upload" },
    });
    expect(created.resumed).toBe(false);
    expect(created.run.status).toBe("pending");

    await companyTransferRunService.recordManifest(
      db,
      created.run.id,
      manifest,
      sha256HexOfBytes(Buffer.from(JSON.stringify(manifest))),
    );
    await companyTransferRunService.start(db, created.run.id);

    const firstChunk = manifest.chunks[0]!.name;
    await companyTransferRunService.completePart(db, created.run.id, firstChunk);
    // Re-completing the same part must not double-count.
    await companyTransferRunService.completePart(db, created.run.id, firstChunk);

    const midway = (await companyTransferRunService.getRun(db, created.run.id))!;
    expect(midway.status).toBe("running");
    expect(midway.completedParts).toEqual([firstChunk]);
    expect(midway.chunkCount).toBe(manifest.chunks.length);
    expect(midway.blobCount).toBe(manifest.blobs.length);

    const remaining = companyTransferRunService.remainingParts(midway, manifest);
    expect(remaining).toEqual([
      manifest.chunks[1]!.name,
      ...manifest.blobs.map((blob) => blob.name),
    ]);

    // Simulate an interruption: the run fails, then the same content retries.
    await companyTransferRunService.fail(db, created.run.id, "connection dropped");
    const resumed = await companyTransferRunService.resumeOrCreate(db, {
      direction: "import",
      actorKey: "user:alice",
      idempotencyKey: manifest.idempotencyKey,
      containerRef: { kind: "zip-upload" },
    });
    expect(resumed.resumed).toBe(true);
    expect(resumed.alreadyCompleted).toBe(false);
    expect(resumed.run.id).toBe(created.run.id);
    expect(resumed.run.completedParts).toEqual([firstChunk]);

    await companyTransferRunService.start(db, resumed.run.id);
    for (const part of companyTransferRunService.remainingParts(resumed.run, manifest)) {
      await companyTransferRunService.completePart(db, resumed.run.id, part);
    }
    await companyTransferRunService.complete(db, resumed.run.id);

    const done = (await companyTransferRunService.getRun(db, created.run.id))!;
    expect(done.status).toBe("completed");
    expect(done.error).toBeNull();
    expect(companyTransferRunService.remainingParts(done, manifest)).toEqual([]);

    // A retry of identical content after completion short-circuits.
    const retried = await companyTransferRunService.resumeOrCreate(db, {
      direction: "import",
      actorKey: "user:alice",
      idempotencyKey: manifest.idempotencyKey,
      containerRef: { kind: "zip-upload" },
    });
    expect(retried.alreadyCompleted).toBe(true);
    expect(retried.run.id).toBe(created.run.id);
  });

  it("leases durable export work, prevents overlapping owners, and records one expiring artifact", async () => {
    const companyId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Export lease owner",
      issuePrefix: `EL${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}` });
    const manifest = { version: 1, source: "accepted-export-selection" };
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const key = randomUUID();
    const { run } = await companyTransferRunService.resumeOrCreate(db, {
      direction: "export", actorKey: "board:export-lease", idempotencyKey: key, companyId,
      containerRef: { version: 1, kind: "company_export_transfer_v1", lease: null, artifact: null },
      manifest, manifestSha256: sha256HexOfBytes(Buffer.from(JSON.stringify(manifest))),
    });
    const replay = await companyTransferRunService.resumeOrCreate(db, {
      direction: "export", actorKey: "board:export-lease", idempotencyKey: key, companyId,
      containerRef: { version: 1, kind: "company_export_transfer_v1", lease: null, artifact: null },
      manifest, manifestSha256: sha256HexOfBytes(Buffer.from(JSON.stringify(manifest))),
    });
    expect(replay.run.id).toBe(run.id);
    expect(replay.resumed).toBe(true);
    const start = new Date(Date.now() + 60_000);
    expect((await companyTransferRunService.claimExport(db, run.id, "worker-a", { now: start, leaseMs: 1000 }))?.status).toBe("running");
    expect(await companyTransferRunService.claimExport(db, run.id, "worker-b", { now: new Date(start.getTime() + 500), leaseMs: 1000 })).toBeNull();
    expect(await companyTransferRunService.renewExportLease(db, run.id, "worker-a", { now: new Date(start.getTime() + 500), leaseMs: 1000 })).toBe(true);
    expect(await companyTransferRunService.claimExport(db, run.id, "worker-b", { now: new Date(start.getTime() + 2000), leaseMs: 1000 })).not.toBeNull();
    expect(await companyTransferRunService.recordExportArtifact(db, run.id, "worker-a", { objectKey: "old", state: "allocated", storageScopeId: "a".repeat(64) })).toBe(false);
    expect(await companyTransferRunService.recordExportArtifact(db, run.id, "worker-b", { objectKey: "private-key", state: "allocated", storageScopeId: "a".repeat(64) })).toBe(true);
    expect(await companyTransferRunService.recordExportArtifact(db, run.id, "worker-b", { objectKey: "replacement-key", state: "allocated", storageScopeId: "a".repeat(64) })).toBe(false);
    expect((await companyTransferRunService.getRun(db, run.id))!.containerRef).toMatchObject({ artifact: { objectKey: "private-key", state: "allocated", storageScopeId: "a".repeat(64) } });
    const sha = sha256HexOfBytes(Buffer.from("private artifact"));
    expect(await companyTransferRunService.recordExportArtifact(db, run.id, "worker-b", { objectKey: "private-key", state: "stored",
      sha256: sha, byteSize: 16, expiresAt, manifestSha256: sha256HexOfBytes(Buffer.from("manifest")) })).toBe(true);
    expect(await companyTransferRunService.completeExport(db, run.id, "worker-b", sha256HexOfBytes(Buffer.from("manifest")))).toBe(true);
    const completed = (await companyTransferRunService.getRun(db, run.id))!;
    expect(completed.status).toBe("completed");
    expect((completed.containerRef as { artifact: { state: string; expiresAt: string } }).artifact).toMatchObject({ state: "ready", expiresAt });
  });

  it("retains late provider receipts and retries cleanup of failed settled artifacts", async () => {
    const companyId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Export receipt owner",
      issuePrefix: `ER${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}` });
    const run = await companyTransferRunService.resumeOrCreate(db, {
      direction: "export", actorKey: "board:export-receipt", idempotencyKey: randomUUID(), companyId,
      containerRef: { version: 1, kind: "company_export_transfer_v1", lease: null, artifact: null },
      manifest: { version: 1, source: "controlled-storage-receipt" },
    });
    const workerId = "receipt-worker";
    const claimed = await companyTransferRunService.claimExport(db, run.run.id, workerId, { leaseMs: 5_000 });
    expect(claimed).not.toBeNull();

    const putStarted = deferred();
    const finishPut = deferred();
    const deleteStarted = deferred();
    const finishDelete = deferred();
    const deleted = new Set<string>();
    let deleteFailures = 1;
    let pauseNextDelete = false;
    let providerPutCount = 0;
    const provider: StorageProvider = {
      id: "local_disk", scopeId: "a".repeat(64),
      async putObject({ objectKey }) { providerPutCount += 1; putStarted.resolve(); await finishPut.promise; deleted.delete(objectKey); },
      async getObject({ objectKey }) { return { stream: Readable.from(Buffer.from(objectKey)) }; },
      async headObject({ objectKey }) { return { exists: !deleted.has(objectKey) }; },
      async deleteObject({ objectKey }) {
        if (deleteFailures-- > 0) throw new Error("controlled delete failure");
        if (pauseNextDelete) {
          pauseNextDelete = false;
          deleteStarted.resolve();
          await finishDelete.promise;
        }
        deleted.add(objectKey);
      },
      async eraseObject(input) {
        await provider.deleteObject(input);
        if ((await provider.headObject(input)).exists) throw new Error("controlled physical erasure unconfirmed");
      },
    };
    const storage = createStorageService(provider);
    const transfers = companyExportTransferService(db, storage, {
      async exportBundle() { throw new Error("unexpected generation during cleanup recovery"); },
      async assertExternalInstructionsAllowed() { return false; },
      async assertExportDownloadAccess() {},
    });
    const bytes = Buffer.from("durable export bytes");
    const manifestSha = sha256HexOfBytes(Buffer.from("export manifest"));
    let allocatedKey = "";
    const put = storage.putFile({ companyId, namespace: `company-exports/${run.run.id}/receipt-worker`,
      originalFilename: "export.json", contentType: "application/json", body: bytes,
      onAllocated: async objectKey => {
        allocatedKey = objectKey;
        expect(await companyTransferRunService.recordExportArtifact(db, run.run.id, workerId,
          { objectKey, state: "allocated", storageScopeId: "a".repeat(64) })).toBe(true);
      },
      onTransportSettled: async objectKey => {
        expect(await companyTransferRunService.recordExportArtifact(db, run.run.id, workerId, {
          objectKey, state: "stored", sha256: sha256HexOfBytes(bytes), byteSize: bytes.length,
          expiresAt: new Date(Date.now() + 60_000).toISOString(), manifestSha256: manifestSha,
        })).toBe(true);
      },
      onWritePrevented: async objectKey => {
        await companyTransferRunService.clearAllocatedExportArtifact(db, run.run.id, workerId, objectKey);
      },
    });
    await putStarted.promise;

    // A second worker sees the original allocation after its lease expires,
    // cannot claim it, and marks the outcome unknown without replacing owner A.
    const expiredRef = (await companyTransferRunService.getRun(db, run.run.id))!.containerRef as Record<string, unknown>;
    await db.update(companyTransferRuns).set({ containerRef: { ...expiredRef,
      lease: { ownerId: workerId, expiresAt: new Date(Date.now() - 1_000).toISOString() } } })
      .where(eq(companyTransferRuns.id, run.run.id));
    expect(await companyTransferRunService.claimExport(db, run.run.id, "worker-b")).toBeNull();
    expect(await companyTransferRunService.prepareCompanyExportErasure(db, companyId).catch(() => "blocked")).toBe("blocked");
    await db.update(companies).set({ status: "archived" }).where(eq(companies.id, companyId));
    expect(await companyTransferRunService.prepareCompanyExportErasure(db, companyId).catch(() => "blocked")).toBe("blocked");

    finishPut.resolve();
    await put;
    let late = (await companyTransferRunService.getRun(db, run.run.id))!;
    expect(late.status).toBe("failed");
    expect(late.error).toBeNull();
    expect((late.containerRef as { artifact: { state: string; objectKey: string } }).artifact)
      .toMatchObject({ state: "stored", objectKey: allocatedKey });
    await expect(companyTransferRunService.prepareCompanyExportErasure(db, companyId, "b".repeat(64)))
      .rejects.toMatchObject({ details: { code: "company_export_storage_scope_changed" } });
    await expect(companyTransferRunService.confirmCompanyExportPrefixErased(db, companyId, "b".repeat(64)))
      .rejects.toMatchObject({ details: { code: "company_export_storage_scope_changed" } });
    expect((await companyTransferRunService.getRun(db, run.run.id))!.containerRef).toMatchObject({ artifact: { state: "stored" } });
    await expect(companyTransferRunService.prepareCompanyExportErasure(db, companyId, "a".repeat(64))).resolves.toBeUndefined();
    await expect(companyTransferRunService.assertCompanyExportErasureComplete(db, companyId)).rejects.toThrow();

    // Failed deletion leaves the known stored receipt discoverable without TTL;
    // only a later provider delete acknowledgement permits its tombstone.
    await expect(storage.deleteObject(companyId, allocatedKey)).rejects.toThrow("controlled delete failure");
    expect((await companyTransferRunService.listExpiredExportArtifacts(db, 20)).map(row => row.id)).toContain(run.run.id);
    await transfers.recoverBatch(20);
    late = (await companyTransferRunService.getRun(db, run.run.id))!;
    expect((late.containerRef as { artifact: { state: string } }).artifact.state).toBe("deleted");
    await expect(companyTransferRunService.assertCompanyExportErasureComplete(db, companyId)).resolves.toBeUndefined();

    // Model an export rejected by its final current-authority check after the
    // provider receipt, then make cleanup fail once and recover from the same
    // bounded ledger query. failExport must preserve the known stored state.
    const secondCompanyId = randomUUID();
    await db.insert(companies).values({ id: secondCompanyId, name: "Stored export cleanup",
      issuePrefix: `EC${secondCompanyId.replace(/-/g, "").slice(0, 6).toUpperCase()}` });
    const secondInput = {
      direction: "export", actorKey: "board:export-final-auth-failure", idempotencyKey: randomUUID(), companyId: secondCompanyId,
      containerRef: { version: 1, kind: "company_export_transfer_v1", lease: null, artifact: null },
      manifest: { version: 1, source: "post-store-authorization-failure" },
    } as const;
    const secondRun = await companyTransferRunService.resumeOrCreate(db, secondInput);
    const secondWorker = "post-store-worker";
    expect(await companyTransferRunService.claimExport(db, secondRun.run.id, secondWorker)).not.toBeNull();
    let secondKey = "";
    await storage.putFile({ companyId: secondCompanyId, namespace: `company-exports/${secondRun.run.id}/post-store-worker`,
      originalFilename: "export.json", contentType: "application/json", body: bytes,
      onAllocated: async objectKey => {
        secondKey = objectKey;
        expect(await companyTransferRunService.recordExportArtifact(db, secondRun.run.id, secondWorker,
          { objectKey, state: "allocated", storageScopeId: "a".repeat(64) })).toBe(true);
      },
      onTransportSettled: async objectKey => {
        expect(await companyTransferRunService.recordExportArtifact(db, secondRun.run.id, secondWorker, {
          objectKey, state: "stored", sha256: sha256HexOfBytes(bytes), byteSize: bytes.length,
          expiresAt: new Date(Date.now() + 60_000).toISOString(), manifestSha256: manifestSha,
        })).toBe(true);
      },
    });
    expect(await companyTransferRunService.failExport(db, secondRun.run.id, secondWorker, "current_authority_lost")).toBe(true);
    expect((await companyTransferRunService.getRun(db, secondRun.run.id))!.containerRef)
      .toMatchObject({ artifact: { state: "stored", objectKey: secondKey } });
    expect(await companyTransferRunService.recordExportArtifact(db, secondRun.run.id, "worker-b", {
      objectKey: secondKey, state: "stored", sha256: sha256HexOfBytes(bytes), byteSize: bytes.length,
      expiresAt: new Date(Date.now() + 60_000).toISOString(), manifestSha256: manifestSha,
    })).toBe(false);
    deleteFailures = 1;
    await expect(storage.deleteObject(secondCompanyId, secondKey)).rejects.toThrow("controlled delete failure");
    expect((await companyTransferRunService.listExpiredExportArtifacts(db, 20)).map(row => row.id)).toContain(secondRun.run.id);
    pauseNextDelete = true;
    const cleanup = transfers.recoverBatch(20);
    await deleteStarted.promise;
    const retry = await companyTransferRunService.resumeOrCreate(db, secondInput);
    expect(retry.run.id).toBe(secondRun.run.id);
    expect(retry.run.status).toBe("failed");
    expect(await companyTransferRunService.claimExport(db, secondRun.run.id, "retry-worker")).toBeNull();
    expect(providerPutCount).toBe(2);
    finishDelete.resolve();
    await cleanup;
    expect((await companyTransferRunService.getRun(db, secondRun.run.id))!.containerRef)
      .toMatchObject({ artifact: { state: "deleted", objectKey: secondKey } });
    expect((await companyTransferRunService.resumeOrCreate(db, secondInput)).run.id).toBe(secondRun.run.id);
    expect(await companyTransferRunService.claimExport(db, secondRun.run.id, "retry-worker")).toBeNull();

    // No-write proof after an expired lease clears only the same allocation;
    // the actual controlled provider is never called for that attempt.
    const noWriteCompanyId = randomUUID();
    await db.insert(companies).values({ id: noWriteCompanyId, name: "Export no-write proof",
      issuePrefix: `NW${noWriteCompanyId.replace(/-/g, "").slice(0, 6).toUpperCase()}` });
    const noWrite = await companyTransferRunService.resumeOrCreate(db, {
      direction: "export", actorKey: "board:export-no-write", idempotencyKey: randomUUID(), companyId: noWriteCompanyId,
      containerRef: { version: 1, kind: "company_export_transfer_v1", lease: null, artifact: null },
    });
    const noWriteOwner = "no-write-owner";
    await db.update(companyTransferRuns).set({ status: "running", containerRef: {
      version: 1, kind: "company_export_transfer_v1",
      lease: { ownerId: noWriteOwner, expiresAt: new Date(Date.now() + 5_000).toISOString() }, artifact: null,
    } }).where(eq(companyTransferRuns.id, noWrite.run.id));
    const noWriteStorage = createStorageService(provider, {
      async reserve() {
        const current = (await companyTransferRunService.getRun(db, noWrite.run.id))!.containerRef as Record<string, unknown>;
        await db.update(companyTransferRuns).set({ containerRef: { ...current,
          lease: { ownerId: noWriteOwner, expiresAt: new Date(Date.now() - 1_000).toISOString() } } })
          .where(eq(companyTransferRuns.id, noWrite.run.id));
        expect(await companyTransferRunService.failExport(db, noWrite.run.id, noWriteOwner, "lease_elapsed")).toBe(true);
        throw new Error("controlled pre-write reservation rejection");
      }, async stored() {}, async deleting() {}, async deleted() {},
    });
    await expect(noWriteStorage.putFile({ companyId: noWriteCompanyId, namespace: `company-exports/${noWrite.run.id}/no-write`,
      originalFilename: "export.json", contentType: "application/json", body: bytes,
      onAllocated: async objectKey => {
        expect(await companyTransferRunService.recordExportArtifact(db, noWrite.run.id, noWriteOwner,
          { objectKey, state: "allocated", storageScopeId: "a".repeat(64) })).toBe(true);
      },
      onWritePrevented: async objectKey => {
        expect(await companyTransferRunService.clearAllocatedExportArtifact(db, noWrite.run.id, noWriteOwner, objectKey)).toBe(true);
      },
    })).rejects.toThrow("controlled pre-write reservation rejection");
    expect(providerPutCount).toBe(2);
    expect((await companyTransferRunService.getRun(db, noWrite.run.id))!.containerRef)
      .toMatchObject({ artifact: null });
  });

  it("scopes resume to the actor and direction", async () => {
    const manifest = demoManifest();
    const aliceRun = await companyTransferRunService.resumeOrCreate(db, {
      direction: "export",
      actorKey: "user:alice",
      idempotencyKey: manifest.idempotencyKey,
      containerRef: { kind: "relay", prefix: "staging/a" },
    });

    const bobRun = await companyTransferRunService.resumeOrCreate(db, {
      direction: "export",
      actorKey: "user:bob",
      idempotencyKey: manifest.idempotencyKey,
      containerRef: { kind: "relay", prefix: "staging/b" },
    });
    expect(bobRun.resumed).toBe(false);
    expect(bobRun.run.id).not.toBe(aliceRun.run.id);

    const aliceImport = await companyTransferRunService.resumeOrCreate(db, {
      direction: "import",
      actorKey: "user:alice",
      idempotencyKey: manifest.idempotencyKey,
      containerRef: { kind: "relay", prefix: "staging/a" },
    });
    expect(aliceImport.resumed).toBe(false);
    expect(aliceImport.run.id).not.toBe(aliceRun.run.id);

    expect(await companyTransferRunService.getRunForActor(db, aliceRun.run.id, "user:bob")).toBeNull();
    expect(await companyTransferRunService.getRunForActor(db, aliceRun.run.id, "user:alice")).not.toBeNull();
  });

  it("creates a single run for concurrent identical declarations", async () => {
    const manifest = demoManifest();
    const input = {
      direction: "import" as const,
      actorKey: "user:dave",
      idempotencyKey: manifest.idempotencyKey,
      containerRef: { kind: "zip-upload" },
    };
    // Without the advisory lock both callers can miss the lookup and both
    // insert; with it, exactly one inserts and the other resumes that row.
    const [first, second] = await Promise.all([
      companyTransferRunService.resumeOrCreate(db, input),
      companyTransferRunService.resumeOrCreate(db, input),
    ]);
    expect(first.run.id).toBe(second.run.id);
    expect([first.resumed, second.resumed].filter(Boolean)).toHaveLength(1);
    expect(first.alreadyCompleted).toBe(false);
    expect(second.alreadyCompleted).toBe(false);
  });

  it("grants the apply claim to exactly one concurrent caller", async () => {
    const manifest = demoManifest();
    const { run } = await companyTransferRunService.resumeOrCreate(db, {
      direction: "import",
      actorKey: "user:erin",
      idempotencyKey: manifest.idempotencyKey,
      containerRef: { kind: "zip-upload" },
    });
    await companyTransferRunService.start(db, run.id);

    const claims = await Promise.all([
      companyTransferRunService.claimApply(db, run.id),
      companyTransferRunService.claimApply(db, run.id),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect((await companyTransferRunService.getRun(db, run.id))!.status).toBe("applying");

    // A concurrent re-declaration resumes the mid-apply run instead of
    // spawning a duplicate, but start() must not restart it.
    const redeclared = await companyTransferRunService.resumeOrCreate(db, {
      direction: "import",
      actorKey: "user:erin",
      idempotencyKey: manifest.idempotencyKey,
      containerRef: { kind: "zip-upload" },
    });
    expect(redeclared.run.id).toBe(run.id);
    expect(redeclared.resumed).toBe(true);
    expect(redeclared.alreadyCompleted).toBe(false);
    await companyTransferRunService.start(db, run.id);
    expect((await companyTransferRunService.getRun(db, run.id))!.status).toBe("applying");

    // A known pre-effect refusal explicitly releases the claim for retry.
    expect(await companyTransferRunService.releaseApplyClaim(db, run.id, "refused before domain dispatch")).toBe(true);
    expect(await companyTransferRunService.claimApply(db, run.id)).toBe(true);
    await companyTransferRunService.complete(db, run.id);
    expect((await companyTransferRunService.getRun(db, run.id))!.status).toBe("completed");
    expect(await companyTransferRunService.claimApply(db, run.id)).toBe(false);
  });

  it("records parts only while the run is open", async () => {
    const manifest = demoManifest();
    const { run } = await companyTransferRunService.resumeOrCreate(db, {
      direction: "import",
      actorKey: "user:frank",
      idempotencyKey: manifest.idempotencyKey,
      containerRef: { kind: "zip-upload" },
    });
    await companyTransferRunService.start(db, run.id);
    expect(await companyTransferRunService.completePart(db, run.id, "part-0")).toBe(true);

    await companyTransferRunService.fail(db, run.id, "swept");
    expect(await companyTransferRunService.completePart(db, run.id, "part-1")).toBe(false);
    expect((await companyTransferRunService.getRun(db, run.id))!.completedParts).toEqual(["part-0"]);
  });

  it("claims an abandoned run only while it is open and still idle", async () => {
    const manifest = demoManifest();
    const { run } = await companyTransferRunService.resumeOrCreate(db, {
      direction: "import",
      actorKey: "user:grace",
      idempotencyKey: manifest.idempotencyKey,
      containerRef: { kind: "zip-upload" },
    });
    await companyTransferRunService.start(db, run.id);

    // Fresh activity: a cutoff in the past misses the guard.
    const past = new Date(Date.now() - 60 * 60 * 1000);
    expect(await companyTransferRunService.cancelIfIdle(db, run.id, past, "stale")).toBe(false);
    expect((await companyTransferRunService.getRun(db, run.id))!.status).toBe("running");

    // Idle past the cutoff: exactly this claim cancels the run.
    const future = new Date(Date.now() + 60 * 60 * 1000);
    expect(await companyTransferRunService.cancelIfIdle(db, run.id, future, "stale")).toBe(true);
    const swept = (await companyTransferRunService.getRun(db, run.id))!;
    expect(swept.status).toBe("cancelled");
    expect(swept.error).toBe("stale");
    // Terminal already — a second claim finds nothing to do.
    expect(await companyTransferRunService.cancelIfIdle(db, run.id, future, "stale")).toBe(false);
    // Cancelled, not failed, so the swept run can never be claimed for an
    // apply while its spool is being deleted.
    expect(await companyTransferRunService.claimApply(db, run.id)).toBe(false);
  });

  it("releases an apply claim without ever reopening a settled run", async () => {
    const manifest = demoManifest();
    const { run } = await companyTransferRunService.resumeOrCreate(db, {
      direction: "import",
      actorKey: "user:heidi",
      idempotencyKey: manifest.idempotencyKey,
      containerRef: { kind: "zip-upload" },
    });
    await companyTransferRunService.start(db, run.id);

    // Releasing a held claim fails the run and makes it claimable again.
    expect(await companyTransferRunService.claimApply(db, run.id)).toBe(true);
    expect(await companyTransferRunService.releaseApplyClaim(db, run.id, "import blew up")).toBe(true);
    const released = (await companyTransferRunService.getRun(db, run.id))!;
    expect(released.status).toBe("failed");
    expect(released.error).toBe("import blew up");
    expect(await companyTransferRunService.claimApply(db, run.id)).toBe(true);

    // Guarded on "applying": after complete() settles the claim, a late
    // release (e.g. a cleanup error caught after success) is a no-op — the
    // run stays completed and can never be flipped back to claimable.
    await companyTransferRunService.complete(db, run.id);
    expect(await companyTransferRunService.releaseApplyClaim(db, run.id, "cleanup failed")).toBe(false);
    const settled = (await companyTransferRunService.getRun(db, run.id))!;
    expect(settled.status).toBe("completed");
    expect(settled.error).toBeNull();
    expect(await companyTransferRunService.claimApply(db, run.id)).toBe(false);
  });

  it("recovers runs stranded in applying by a restart, leaving live runs alone", async () => {
    const strandedManifest = demoManifest();
    const { run: stranded } = await companyTransferRunService.resumeOrCreate(db, {
      direction: "import",
      actorKey: "user:ivan",
      idempotencyKey: strandedManifest.idempotencyKey,
      containerRef: { kind: "zip-upload" },
    });
    await companyTransferRunService.start(db, stranded.id);
    expect(await companyTransferRunService.claimApply(db, stranded.id)).toBe(true);

    const openManifest = demoManifest();
    const { run: open } = await companyTransferRunService.resumeOrCreate(db, {
      direction: "import",
      actorKey: "user:ivan",
      idempotencyKey: openManifest.idempotencyKey,
      containerRef: { kind: "zip-upload" },
    });
    await companyTransferRunService.start(db, open.id);

    // The process "restarted": whether the external effect committed is
    // unknowable, so recovery must fence another apply pending reconciliation.
    const recovered = await companyTransferRunService.recoverStrandedApplyingRuns(db);
    expect(recovered).toContain(stranded.id);
    expect(recovered).not.toContain(open.id);
    const recoveredRun = (await companyTransferRunService.getRun(db, stranded.id))!;
    expect(recoveredRun.status).toBe("needs_reconciliation");
    expect(recoveredRun.error).toMatch(/unknown|reconcil/i);
    expect(await companyTransferRunService.claimApply(db, stranded.id)).toBe(false);

    // Runs that were merely uploading are untouched.
    expect((await companyTransferRunService.getRun(db, open.id))!.status).toBe("running");
  });

  it("fences a possibly committed import effect after restart and resumes its same run", async () => {
    const companyId = randomUUID();
    const projectId = randomUUID();
    const manifest = demoManifest();
    await db.insert(companies).values({ id: companyId, name: "Import target",
      issuePrefix: `TR${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}` });
    const input = {
      direction: "import" as const,
      actorKey: "user:unknown-outcome",
      idempotencyKey: manifest.idempotencyKey,
      containerRef: { kind: "zip-upload" },
      companyId,
    };
    const created = await companyTransferRunService.resumeOrCreate(db, input);
    await companyTransferRunService.start(db, created.run.id);
    expect(await companyTransferRunService.claimApply(db, created.run.id)).toBe(true);

    // This native project insert stands in for the committed import effect;
    // the process dies before it can settle the durable apply claim.
    await db.insert(projects).values({ id: projectId, companyId, name: "Committed imported project",
      status: "in_progress" });

    const restarted = createDb(tempDb!.connectionString);
    try {
      const recovered = await companyTransferRunService.recoverStrandedApplyingRuns(restarted);
      expect(recovered).toContain(created.run.id);
      const uncertain = (await companyTransferRunService.getRun(restarted, created.run.id))!;
      expect(uncertain.status).toBe("needs_reconciliation");
      // Late generic upload/failure/cancellation paths cannot make an
      // uncertain non-idempotent effect eligible to execute again.
      await companyTransferRunService.start(restarted, created.run.id);
      await companyTransferRunService.fail(restarted, created.run.id, "late upload error");
      await companyTransferRunService.cancel(restarted, created.run.id);
      expect((await companyTransferRunService.getRun(restarted, created.run.id))!.status).toBe("needs_reconciliation");
      expect(await companyTransferRunService.claimApply(restarted, created.run.id)).toBe(false);

      const resumed = await companyTransferRunService.resumeOrCreate(restarted, input);
      expect(resumed.run.id).toBe(created.run.id);
      expect(resumed.run.status).toBe("needs_reconciliation");
      expect(resumed.resumed).toBe(true);
      expect(await restarted.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)))
        .toHaveLength(1);
    } finally {
      await restarted.$client.end();
    }
  });

  it("keeps legacy failed imports unclaimable when the retained-history migration runs", async () => {
    // Structural pre-upgrade rows: the old failed label cannot prove whether
    // domain effects committed. No receipt or successful import is inferred.
    const oldImport = await companyTransferRunService.resumeOrCreate(db, {
      direction: "import", actorKey: "user:legacy-failure", idempotencyKey: randomUUID(), containerRef: { kind: "zip-upload" },
    });
    const exportRun = await companyTransferRunService.resumeOrCreate(db, {
      direction: "export", actorKey: "user:legacy-failure", idempotencyKey: randomUUID(), containerRef: { kind: "zip-upload" },
    });
    await companyTransferRunService.fail(db, oldImport.run.id, "legacy unspecified failure");
    await companyTransferRunService.fail(db, exportRun.run.id, "export upload failure");
    const migration = await readFile(new URL("../../../packages/db/src/migrations/0527_retain_uncertain_import_history.sql", import.meta.url), "utf8");
    await db.$client.unsafe(migration);
    await db.$client.unsafe(migration); // Safe journal repair/reapplication.
    expect((await companyTransferRunService.getRun(db, oldImport.run.id))!.status).toBe("needs_reconciliation");
    expect(await companyTransferRunService.claimApply(db, oldImport.run.id)).toBe(false);
    expect((await companyTransferRunService.getRun(db, exportRun.run.id))!.status).toBe("failed");
    expect(await companyTransferRunService.claimApply(db, exportRun.run.id)).toBe(true);
  });

  it("settles and erases a late stored artifact after export cancellation without reopening the run", async () => {
    const companyId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Cancelled export receipt",
      issuePrefix: `CR${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}` });
    const { run } = await companyTransferRunService.resumeOrCreate(db, {
      direction: "export", actorKey: "board:cancelled-export", idempotencyKey: randomUUID(), companyId,
      containerRef: { version: 1, kind: "company_export_transfer_v1", lease: null, artifact: null },
    });
    const workerId = "original-cancelled-worker", objectKey = `${companyId}/company-exports/${run.id}/late.json`;
    expect(await companyTransferRunService.claimExport(db, run.id, workerId)).not.toBeNull();
    expect(await companyTransferRunService.recordExportArtifact(db, run.id, workerId,
      { objectKey, state: "allocated", storageScopeId: "a".repeat(64) })).toBe(true);
    await companyTransferRunService.cancel(db, run.id);

    const receipt = { objectKey, state: "stored" as const, sha256: "b".repeat(64), byteSize: 1,
      expiresAt: new Date(Date.now() + 60_000).toISOString(), manifestSha256: "c".repeat(64) };
    expect(await companyTransferRunService.recordExportArtifact(db, run.id, "other-worker", receipt)).toBe(false);
    expect(await companyTransferRunService.recordExportArtifact(db, run.id, workerId, { ...receipt, objectKey: `${objectKey}.other` })).toBe(false);
    expect(await companyTransferRunService.recordExportArtifact(db, run.id, workerId, receipt)).toBe(true);
    expect(await companyTransferRunService.claimExport(db, run.id, "retry-worker")).toBeNull();
    expect(await companyTransferRunService.completeExport(db, run.id, workerId, "c".repeat(64))).toBe(false);
    const settled = (await companyTransferRunService.getRun(db, run.id))!;
    expect(settled.status).toBe("cancelled");
    expect(settled.containerRef).toMatchObject({ artifact: { state: "stored", objectKey, storageScopeId: "a".repeat(64) } });
    const replay = await companyTransferRunService.resumeOrCreate(db, {
      direction: "export", actorKey: "board:cancelled-export", idempotencyKey: run.idempotencyKey, companyId,
      containerRef: { version: 1, kind: "company_export_transfer_v1", lease: null, artifact: null },
    });
    expect(replay.run.id).toBe(run.id);
    expect(replay.run.status).toBe("cancelled");

    const erased: string[] = [];
    const storage = createStorageService({
      id: "local_disk", scopeId: "a".repeat(64),
      async putObject() {},
      async getObject() { return { stream: Readable.from([]) }; },
      async headObject() { return { exists: false }; },
      async deleteObject({ objectKey: key }) { erased.push(key); },
      async eraseObject({ objectKey: key }) { erased.push(key); },
    });
    const transfers = companyExportTransferService(db, storage, {
      async exportBundle() { throw new Error("cancelled export must not regenerate"); },
      async assertExternalInstructionsAllowed() { return false; },
      async assertExportDownloadAccess() {},
    });
    expect((await companyTransferRunService.listExpiredExportArtifacts(db)).map(row => row.id)).toContain(run.id);
    await transfers.recoverBatch();
    expect(erased).toEqual([objectKey]);
    const deleted = (await companyTransferRunService.getRun(db, run.id))!;
    expect(deleted.status).toBe("cancelled");
    expect(deleted.containerRef).toMatchObject({ artifact: { state: "deleted", objectKey } });

    const noWrite = await companyTransferRunService.resumeOrCreate(db, {
      direction: "export", actorKey: "board:cancelled-no-write", idempotencyKey: randomUUID(), companyId,
      containerRef: { version: 1, kind: "company_export_transfer_v1", lease: null, artifact: null },
    });
    const noWriteWorker = "original-no-write-worker", noWriteKey = `${companyId}/company-exports/${noWrite.run.id}/prevented.json`;
    expect(await companyTransferRunService.claimExport(db, noWrite.run.id, noWriteWorker)).not.toBeNull();
    expect(await companyTransferRunService.recordExportArtifact(db, noWrite.run.id, noWriteWorker,
      { objectKey: noWriteKey, state: "allocated", storageScopeId: "a".repeat(64) })).toBe(true);
    await companyTransferRunService.cancel(db, noWrite.run.id);
    expect(await companyTransferRunService.clearAllocatedExportArtifact(db, noWrite.run.id, "other-worker", noWriteKey)).toBe(false);
    expect(await companyTransferRunService.clearAllocatedExportArtifact(db, noWrite.run.id, noWriteWorker, `${noWriteKey}.other`)).toBe(false);
    expect(await companyTransferRunService.clearAllocatedExportArtifact(db, noWrite.run.id, noWriteWorker, noWriteKey)).toBe(true);
    const cleared = (await companyTransferRunService.getRun(db, noWrite.run.id))!;
    expect(cleared.status).toBe("cancelled");
    expect(cleared.containerRef).toMatchObject({ artifact: null });
  });

  it("does not restart a cancelled run", async () => {
    const manifest = demoManifest();
    const { run } = await companyTransferRunService.resumeOrCreate(db, {
      direction: "import",
      actorKey: "user:carol",
      idempotencyKey: manifest.idempotencyKey,
      containerRef: { kind: "zip-upload" },
    });
    await companyTransferRunService.cancel(db, run.id);
    await companyTransferRunService.start(db, run.id);
    expect((await companyTransferRunService.getRun(db, run.id))!.status).toBe("cancelled");

    // Cancelled runs are not resumed; the same content starts a fresh run.
    const fresh = await companyTransferRunService.resumeOrCreate(db, {
      direction: "import",
      actorKey: "user:carol",
      idempotencyKey: manifest.idempotencyKey,
      containerRef: { kind: "zip-upload" },
    });
    expect(fresh.resumed).toBe(false);
    expect(fresh.run.id).not.toBe(run.id);

    const cancelledExport = await companyTransferRunService.resumeOrCreate(db, {
      direction: "export", actorKey: "user:carol", idempotencyKey: manifest.idempotencyKey,
      containerRef: { version: 1, kind: "company_export_transfer_v1", lease: null, artifact: null },
    });
    await companyTransferRunService.cancel(db, cancelledExport.run.id);
    const replayedExport = await companyTransferRunService.resumeOrCreate(db, {
      direction: "export", actorKey: "user:carol", idempotencyKey: manifest.idempotencyKey,
      containerRef: { version: 1, kind: "company_export_transfer_v1", lease: null, artifact: null },
    });
    expect(replayedExport.run.id).toBe(cancelledExport.run.id);
    expect(replayedExport.run.status).toBe("cancelled");
    expect(replayedExport.resumed).toBe(true);
  });
});
