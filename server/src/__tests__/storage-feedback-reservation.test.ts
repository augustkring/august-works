import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStorageService } from "../storage/service.js";
import { createLocalDiskStorageProvider } from "../storage/local-disk-provider.js";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "aw-feedback-original-storage-"));
  directories.push(directory);
  return { directory, provider: createLocalDiskStorageProvider(directory) };
}
const input = { companyId: "owned-company", namespace: "feedback-images/owned-feedback/owned-image",
  originalFilename: "image.png", contentType: "image/png", body: Buffer.from("owned-storage-fixture-bytes") };
describe("original Storage durable allocation callback", () => {
  it("awaits the allocated company key before accounting or actual filesystem writes", async () => {
    const { provider } = await fixture(), order: string[] = [];
    const reserve = vi.fn(async (_companyId: string, key: string) => {
      expect(order).toEqual(["allocated"]);
      expect(await provider.headObject({ objectKey: key })).toEqual({ exists: false });
      order.push("reserved");
    });
    const storage = createStorageService(provider, { reserve, stored: async (_company, key) => {
      expect((await provider.headObject({ objectKey: key })).exists).toBe(true); order.push("stored");
    }, deleting: async () => {}, deleted: async () => {} });
    const result = await storage.putFile({ ...input, onAllocated: async key => {
      expect(key.startsWith("owned-company/feedback-images/owned-feedback/owned-image/")).toBe(true);
      expect((await provider.headObject({ objectKey: key })).exists).toBe(false);
      await Promise.resolve(); order.push("allocated");
    } });
    expect(order).toEqual(["allocated", "reserved", "stored"]);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.byteSize).toBe(input.body.length);
  });
  it("creates neither a reservation nor a physical object when the native allocation fence refuses", async () => {
    const { directory, provider } = await fixture(), reserve = vi.fn();
    const storage = createStorageService(provider, { reserve, stored: vi.fn(), deleting: vi.fn(), deleted: vi.fn() });
    await expect(storage.putFile({ ...input, onAllocated: async () => { throw new Error("owned-native-fence-refused"); } }))
      .rejects.toThrow("owned-native-fence-refused");
    expect(reserve).not.toHaveBeenCalled(); expect(await readdir(directory)).toEqual([]);
  });
  it("retains the allocated key for read-back after an actual write loses its accounting acknowledgement", async () => {
    const { provider } = await fixture();
    let key: string | null = null;
    const storage = createStorageService(provider, { reserve: async () => {}, stored: async () => { throw new Error("owned-ack-lost"); },
      deleting: async () => {}, deleted: async () => {} });
    await expect(storage.putFile({ ...input, onAllocated: async value => { key = value; } })).rejects.toThrow("owned-ack-lost");
    expect(key).not.toBeNull();
    expect(await storage.headObject(input.companyId, key!)).toMatchObject({ exists: true, contentLength: input.body.length });
    const result = await storage.getObject(input.companyId, key!), chunks: Buffer[] = [];
    for await (const chunk of result.stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(input.body);
    await storage.deleteObject(input.companyId, key!);
    expect(await storage.headObject(input.companyId, key!)).toEqual({ exists: false });
  });
});
