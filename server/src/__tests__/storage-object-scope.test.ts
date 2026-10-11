import { describe, expect, it } from "vitest";
import { createLocalDiskStorageProvider } from "../storage/local-disk-provider.js";
import { createS3StorageProvider } from "../storage/s3-provider.js";
import { createStorageService } from "../storage/service.js";
import { storageScopeMatches } from "../storage/object-scope.js";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("original configured object namespace identity", () => {
  it("normalizes disk locators and distinguishes another actual configured root", () => {
    const original = createLocalDiskStorageProvider("/owned-fixture/objects");
    const equivalent = createLocalDiskStorageProvider("/owned-fixture/objects/../objects");
    const other = createLocalDiskStorageProvider("/owned-fixture/other-objects");
    expect(original.scopeId).toMatch(/^[a-f0-9]{64}$/);
    expect(equivalent.scopeId).toBe(original.scopeId);
    expect(other.scopeId).not.toBe(original.scopeId);
    const service = createStorageService(original);
    expect(storageScopeMatches(service, original.scopeId)).toBe(true);
    expect(storageScopeMatches(service, other.scopeId)).toBe(false);
    expect(storageScopeMatches(service, null)).toBe(false);
    expect(storageScopeMatches(service, undefined)).toBe(false);
    expect(storageScopeMatches({ scopeId: "fabricated" }, "fabricated")).toBe(false);
  });
  it("binds S3 bucket, region, endpoint, prefix and addressing mode without contacting a provider", () => {
    const config = { bucket: "owned-bucket", region: "eu-west-1", endpoint: "https://objects.example.test", prefix: "private" };
    const original = createS3StorageProvider(config);
    expect(original.scopeId).toMatch(/^[a-f0-9]{64}$/);
    expect(createS3StorageProvider({ ...config, prefix: "/private/", endpoint: "https://objects.example.test/" }).scopeId).toBe(original.scopeId);
    for (const change of [{ bucket: "other-bucket" }, { region: "eu-west-2" }, { endpoint: "https://other.example.test" },
      { prefix: "other-prefix" }, { forcePathStyle: true }])
      expect(createS3StorageProvider({ ...config, ...change }).scopeId).not.toBe(original.scopeId);
    expect(createStorageService(original).scopeId).toBe(original.scopeId);
    expect(original.scopeId).not.toContain(config.bucket);
  });
  it("does not invent a known scope for a secret-bearing endpoint or a legacy custom provider", () => {
    for (const endpoint of ["https://secret:password@objects.example.test", "https://objects.example.test?token=secret", "https://objects.example.test#secret"])
      expect(createS3StorageProvider({ bucket: "owned-bucket", region: "eu-west-1", endpoint }).scopeId).toBeUndefined();
    const original = createLocalDiskStorageProvider("/owned-fixture/objects");
    const { scopeId: _scopeId, ...legacy } = original;
    expect(createStorageService(legacy).scopeId).toBeUndefined();
    expect(storageScopeMatches(createStorageService(legacy), original.scopeId)).toBe(false);
  });
  it("does not report absence or fulfilled deletion for a real filesystem error", async () => {
    const root = await mkdtemp(join(tmpdir(), "aw-storage-error-owned-"));
    try {
      const provider = createLocalDiskStorageProvider(root);
      await writeFile(join(root, "owned-file"), "owned");
      await expect(provider.headObject({ objectKey: "owned-file/child" })).rejects.toMatchObject({ code: "ENOTDIR" });
      await mkdir(join(root, "owned-directory"));
      await expect(provider.deleteObject({ objectKey: "owned-directory" })).rejects.toMatchObject({ code: "EISDIR" });
      expect(await provider.headObject({ objectKey: "owned-directory/missing" })).toEqual({ exists: false });
      await expect(provider.deleteObject({ objectKey: "owned-directory/missing" })).resolves.toBeUndefined();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
