import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  readdir,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createEncryptedBackup, restoreEncryptedBackup } from "./backup.mjs";
const spec = {
  id: "backup-fixture",
  companyId: "company-a",
  cellId: "cell-a",
  generation: "1",
  imageDigest: "fixture@sha256:" + "a".repeat(64),
  stateFormat: "v1",
  key: "b".repeat(64),
  maxBytes: "1000000",
};
test("encrypted state survives quarantine restore while provider credentials are removed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aw-backup-"));
  try {
    const state = path.join(root, "state");
    await mkdir(state);
    await mkdir(path.join(state, "memory"));
    await mkdir(path.join(state, "credentials"));
    await writeFile(
      path.join(state, "memory", "é😀.md"),
      "Persistent provider memory",
    );
    await writeFile(
      path.join(state, "credentials", "provider.json"),
      "BYOK-fixture",
    );
    await writeFile(path.join(state, "openclaw.json"), "Gateway-fixture");
    const archive = path.join(root, "backup.awb6"),
      evidence = await createEncryptedBackup(state, archive, spec);
    const ciphertext = await readFile(archive);
    assert(!ciphertext.includes(Buffer.from("Persistent provider memory")));
    assert(!ciphertext.includes(Buffer.from("BYOK-fixture")));
    const restored = path.join(root, "restored");
    assert.deepEqual(
      await restoreEncryptedBackup(archive, restored, spec, evidence.sha256),
      { quarantined: true, credentialsRemoved: true },
    );
    assert.equal(
      await readFile(path.join(restored, "memory", "é😀.md"), "utf8"),
      "Persistent provider memory",
    );
    assert.deepEqual(await readdir(restored), ["memory"]);
    await assert.rejects(
      restoreEncryptedBackup(
        archive,
        path.join(root, "wrong"),
        { ...spec, companyId: "company-b" },
        evidence.sha256,
      ),
    );
    assert(!(await readdir(root)).includes("wrong"));
    ciphertext[20] ^= 1;
    await writeFile(archive, ciphertext);
    await assert.rejects(
      restoreEncryptedBackup(
        archive,
        path.join(root, "tampered"),
        spec,
        evidence.sha256,
      ),
      /backup_checksum_mismatch/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("state symlinks are rejected before an archive can include another directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aw-backup-link-"));
  try {
    const state = path.join(root, "state");
    await mkdir(state);
    await symlink("/etc/passwd", path.join(state, "outside"));
    await assert.rejects(
      createEncryptedBackup(state, path.join(root, "archive"), spec),
      /unsupported_backup_file_type/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
