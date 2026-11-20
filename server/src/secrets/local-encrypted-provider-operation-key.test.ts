import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { localEncryptedProvider, withLocalEncryptedMasterKey } from "./local-encrypted-provider.js";

// MS1f stop 8 (the PERF2b withDecisionSigningKey pattern): one master key per
// operation, resolved on first use; a rotated key applies at the next operation.
describe("local encrypted master key per operation", () => {
  let dir = "", keyFile = "";
  const saved = { file: process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE, key: process.env.PAPERCLIP_SECRETS_MASTER_KEY };
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "paperclip-operation-key-"));
    keyFile = path.join(dir, "master.key");
    process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = keyFile;
    delete process.env.PAPERCLIP_SECRETS_MASTER_KEY;
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (saved.file === undefined) delete process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE; else process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = saved.file;
    if (saved.key === undefined) delete process.env.PAPERCLIP_SECRETS_MASTER_KEY; else process.env.PAPERCLIP_SECRETS_MASTER_KEY = saved.key;
  });
  const resolve = (material: unknown) => localEncryptedProvider.resolveVersion({ material: material as never, externalRef: null });

  it("decrypts with the key resolved once in the operation; the next operation re-resolves", async () => {
    writeFileSync(keyFile, randomBytes(32).toString("base64"), { mode: 0o600 });
    const { material } = await localEncryptedProvider.createVersion({ value: "registered-secret" } as never);
    expect(await resolve(material)).toBe("registered-secret");
    await withLocalEncryptedMasterKey(async () => {
      expect(await resolve(material)).toBe("registered-secret");
      // Rotated during the operation: this operation keeps its resolved key.
      writeFileSync(keyFile, randomBytes(32).toString("base64"), { mode: 0o600 });
      expect(await resolve(material)).toBe("registered-secret");
      // A nested scope reuses the outer operation's key.
      await withLocalEncryptedMasterKey(async () => { expect(await resolve(material)).toBe("registered-secret"); });
    });
    // Outside any operation, and in the next operation, the rotated key applies.
    await expect(resolve(material)).rejects.toThrow(/Secret decryption failed/);
    await expect(withLocalEncryptedMasterKey(() => resolve(material))).rejects.toThrow(/Secret decryption failed/);
  });

  it("resolves the key only on first use", async () => {
    await withLocalEncryptedMasterKey(async () => undefined);
    expect(existsSync(keyFile)).toBe(false);
  });
});
