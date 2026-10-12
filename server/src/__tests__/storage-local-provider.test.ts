import { afterEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { createLocalDiskStorageProvider } from "../storage/local-disk-provider.js";
import { createStorageService } from "../storage/service.js";

async function readStreamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe("local disk storage provider", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => fs.rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it("round-trips bytes through storage service", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-storage-"));
    tempRoots.push(root);

    const service = createStorageService(createLocalDiskStorageProvider(root));
    const content = Buffer.from("hello image bytes", "utf8");
    const stored = await service.putFile({
      companyId: "company-1",
      namespace: "issues/issue-1",
      originalFilename: "demo.png",
      contentType: "image/png",
      body: content,
    });

    const fetched = await service.getObject("company-1", stored.objectKey);
    const fetchedBody = await readStreamToBuffer(fetched.stream);

    expect(fetchedBody.toString("utf8")).toBe("hello image bytes");
    expect(stored.sha256).toHaveLength(64);
  });

  it("streams only requested byte ranges", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-storage-"));
    tempRoots.push(root);

    const service = createStorageService(createLocalDiskStorageProvider(root));
    const stored = await service.putFile({
      companyId: "company-1",
      namespace: "issues/issue-1",
      originalFilename: "demo.mp4",
      contentType: "video/mp4",
      body: Buffer.from("0123456789", "utf8"),
    });

    const fetched = await service.getObject("company-1", stored.objectKey, { range: { start: 2, end: 5 } });
    const fetchedBody = await readStreamToBuffer(fetched.stream);

    expect(fetchedBody.toString("utf8")).toBe("2345");
    expect(fetched.contentLength).toBe(4);
  });

  it("removes partial private bytes after a source stream fails and preserves the existing object", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-storage-"));
    tempRoots.push(root);
    const provider = createLocalDiskStorageProvider(root), objectKey = "company-1/private/image.png";
    const committed = Buffer.from("previous accepted image");
    await provider.putObject({ objectKey, body: committed, contentType: "image/png", contentLength: committed.length });
    const source = Readable.from((async function* () {
      yield Buffer.from("partial private image bytes");
      throw new Error("source interrupted");
    })());
    await expect(provider.putObject({ objectKey, body: source, contentType: "image/png", contentLength: 100 }))
      .rejects.toThrow("source interrupted");
    expect(await fs.readdir(path.join(root, "company-1/private"))).toEqual(["image.png"]);
    expect(await fs.readFile(path.join(root, objectKey))).toEqual(committed);
    expect((await fs.stat(path.join(root, objectKey))).mode & 0o077).toBe(0);
  });

  it("removes its temporary copy when atomic publication fails without deleting the destination", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-storage-"));
    tempRoots.push(root);
    const objectKey = "company-1/private/image.png", destination = path.join(root, objectKey);
    await fs.mkdir(destination, { recursive: true });
    await fs.writeFile(path.join(destination, "keep.txt"), "existing destination");
    await expect(createLocalDiskStorageProvider(root).putObject({ objectKey, body: Buffer.from("private image"),
      contentType: "image/png", contentLength: 13 })).rejects.toThrow();
    expect(await fs.readdir(path.dirname(destination))).toEqual(["image.png"]);
    expect(await fs.readFile(path.join(destination, "keep.txt"), "utf8")).toBe("existing destination");
  });

  it("erases interrupted and legacy temporary copies for the exact object even when its final file is absent", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-storage-"));
    tempRoots.push(root);
    const directory = path.join(root, "company-1/private");
    await fs.mkdir(directory, { recursive: true });
    for (const name of ["image.png.tmp-interrupted", "image.png.tmp-1791844090374-legacy", "image.png2.tmp-unrelated"])
      await fs.writeFile(path.join(directory, name), "private copy");
    const service = createStorageService(createLocalDiskStorageProvider(root));
    await service.deleteObject("company-1", "company-1/private/image.png");
    await service.deleteObject("company-1", "company-1/private/image.png");
    expect(await fs.readdir(directory)).toEqual(["image.png2.tmp-unrelated"]);
    expect(await fs.readFile(path.join(directory, "image.png2.tmp-unrelated"), "utf8")).toBe("private copy");
  });

  it("refuses deletion acknowledgement when a temporary copy cannot be removed", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-storage-"));
    tempRoots.push(root);
    const service = createStorageService(createLocalDiskStorageProvider(root));
    const stored = await service.putFile({ companyId: "company-1", namespace: "feedback-images/feedback/image",
      originalFilename: "image.png", contentType: "image/png", body: Buffer.from("private image") });
    await fs.mkdir(path.join(root, `${stored.objectKey}.tmp-blocked`));
    await expect(service.deleteObject("company-1", stored.objectKey)).rejects.toThrow();
    expect(await service.headObject("company-1", stored.objectKey)).toMatchObject({ exists: true });
    expect((await fs.stat(path.join(root, `${stored.objectKey}.tmp-blocked`))).isDirectory()).toBe(true);
  });

  it("blocks cross-company object access", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-storage-"));
    tempRoots.push(root);

    const service = createStorageService(createLocalDiskStorageProvider(root));
    const stored = await service.putFile({
      companyId: "company-a",
      namespace: "issues/issue-1",
      originalFilename: "demo.png",
      contentType: "image/png",
      body: Buffer.from("hello", "utf8"),
    });

    await expect(service.getObject("company-b", stored.objectKey)).rejects.toMatchObject({ status: 403 });
  });

  it("delete is idempotent", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-storage-"));
    tempRoots.push(root);

    const service = createStorageService(createLocalDiskStorageProvider(root));
    const stored = await service.putFile({
      companyId: "company-1",
      namespace: "issues/issue-1",
      originalFilename: "demo.png",
      contentType: "image/png",
      body: Buffer.from("hello", "utf8"),
    });

    await service.deleteObject("company-1", stored.objectKey);
    await service.deleteObject("company-1", stored.objectKey);
    await expect(service.getObject("company-1", stored.objectKey)).rejects.toMatchObject({ status: 404 });
  });
});
