import {
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { createS3StorageProvider } from "../storage/s3-provider.js";
import { createStorageService } from "../storage/service.js";

describe("S3 exact physical erasure", () => {
  it.each(["present", "unrecognized_404"])("keeps erasure pending when HEAD reports %s after empty listings", async outcome => {
    const clientSend = vi.spyOn(S3Client.prototype, "send");
    const deleted = vi.fn(async () => {});
    clientSend.mockImplementation(async (command: any) => {
      if (command instanceof ListObjectVersionsCommand) return { Versions: [], DeleteMarkers: [] } as any;
      if (command instanceof ListObjectsV2Command) return { Contents: [] } as any;
      if (command instanceof HeadObjectCommand) {
        if (outcome === "present") return {} as any;
        throw Object.assign(new Error("unclassified response"), { $metadata: { httpStatusCode: 404 } });
      }
      throw new Error("unexpected destructive command after empty listings");
    });
    const storage = createStorageService(createS3StorageProvider({ bucket: "exports", region: "us-east-1" }), {
      async reserve() {}, async stored() {}, async deleting() {}, deleted,
    });
    try {
      await expect(storage.eraseObject!("company-1", "company-1/private/image.png"))
        .rejects.toMatchObject({ details: { code: "storage_object_erasure_pending" } });
      expect(deleted).not.toHaveBeenCalled();
    } finally { clientSend.mockRestore(); }
  });

  it("removes every exact-key version, delete marker, and current copy without touching a nearby key", async () => {
    const clientSend = vi.spyOn(S3Client.prototype, "send");
    const versions = new Map<string, Array<{ VersionId: string; DeleteMarker?: boolean }>>([
      ["root/company-1/private/image.png", [
        { VersionId: "current" }, { VersionId: "older" }, { VersionId: "marker", DeleteMarker: true },
      ]],
      ["root/company-1/private/image.png-extra", [{ VersionId: "neighbor" }]],
    ]);
    const active = new Set(["root/company-1/private/image.png", "root/company-1/private/image.png-extra"]);
    const deletes: string[] = [];
    clientSend.mockImplementation(async (command: any) => {
      if (command instanceof ListObjectVersionsCommand) {
        const records = [...versions.entries()].flatMap(([Key, items]) => items.map(item => ({ Key, ...item })));
        return { Versions: records.filter(item => !item.DeleteMarker), DeleteMarkers: records.filter(item => item.DeleteMarker) } as any;
      }
      if (command instanceof ListObjectsV2Command)
        return { Contents: [...active].map(Key => ({ Key })) } as any;
      if (command instanceof DeleteObjectCommand) {
        const { Key, VersionId } = command.input;
        deletes.push(`${Key}:${VersionId ?? "unqualified"}`);
        if (VersionId) versions.set(Key!, (versions.get(Key!) ?? []).filter(item => item.VersionId !== VersionId));
        else {
          active.delete(Key!);
          // Versioned DeleteObject publishes a delete marker which the following loop must remove.
          versions.set(Key!, [...(versions.get(Key!) ?? []), { VersionId: "generated-marker", DeleteMarker: true }]);
        }
        return {} as any;
      }
      if (command instanceof HeadObjectCommand) {
        if (active.has(command.input.Key!)) return {} as any;
        throw Object.assign(new Error("missing"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
      }
      throw new Error(`unexpected S3 command: ${command.constructor.name}`);
    });
    const provider = createS3StorageProvider({ bucket: "exports", region: "us-east-1", prefix: "root" });
    try {
      await createStorageService(provider).eraseObject!("company-1", "company-1/private/image.png");
      expect(deletes).toEqual([
        "root/company-1/private/image.png:current",
        "root/company-1/private/image.png:older",
        "root/company-1/private/image.png:marker",
        "root/company-1/private/image.png:unqualified",
        "root/company-1/private/image.png:generated-marker",
      ]);
      expect(versions.get("root/company-1/private/image.png-extra")).toEqual([{ VersionId: "neighbor" }]);
      expect(active.has("root/company-1/private/image.png-extra")).toBe(true);
    } finally {
      clientSend.mockRestore();
    }
  });

  it("leaves accounting pending when S3 cannot prove exact-key absence", async () => {
    const clientSend = vi.spyOn(S3Client.prototype, "send");
    const transitions: string[] = [];
    clientSend.mockRejectedValue(Object.assign(new Error("access denied"), { name: "AccessDenied" }));
    const provider = createS3StorageProvider({ bucket: "exports", region: "us-east-1" });
    const service = createStorageService(provider, {
      async reserve() {}, async stored() {},
      async deleting(_companyId, key) { transitions.push(`deleting:${key}`); },
      async deleted(_companyId, key) { transitions.push(`deleted:${key}`); },
    });
    try {
      await expect(service.eraseObject!("company-1", "company-1/private/image.png"))
        .rejects.toMatchObject({ details: { code: "storage_object_erasure_pending" } });
      expect(transitions).toEqual(["deleting:company-1/private/image.png"]);
    } finally {
      clientSend.mockRestore();
    }
  });

  it("does not record deletion when an acknowledged version delete leaves a version behind", async () => {
    const clientSend = vi.spyOn(S3Client.prototype, "send");
    const transitions: string[] = [];
    let versionCalls = 0;
    clientSend.mockImplementation(async (command: any) => {
      if (command instanceof ListObjectVersionsCommand) {
        versionCalls++;
        return { Versions: versionCalls === 1 || versionCalls >= 3
          ? [{ Key: "company-1/private/image.png", VersionId: "still-there" }] : [] } as any;
      }
      if (command instanceof ListObjectsV2Command) return { Contents: [] } as any;
      if (command instanceof DeleteObjectCommand) return {} as any; // provider ACK only; simulated version remains.
      throw new Error(`unexpected S3 command: ${command.constructor.name}`);
    });
    const provider = createS3StorageProvider({ bucket: "exports", region: "us-east-1" });
    const service = createStorageService(provider, {
      async reserve() {}, async stored() {},
      async deleting(_companyId, key) { transitions.push(`deleting:${key}`); },
      async deleted(_companyId, key) { transitions.push(`deleted:${key}`); },
    });
    try {
      await expect(service.eraseObject!("company-1", "company-1/private/image.png"))
        .rejects.toMatchObject({ details: { code: "storage_object_erasure_pending" } });
      expect(transitions).toEqual(["deleting:company-1/private/image.png"]);
    } finally {
      clientSend.mockRestore();
    }
  });
});
