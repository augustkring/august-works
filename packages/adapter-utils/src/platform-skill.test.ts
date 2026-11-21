import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { readRequiredPlatformSkillFiles } from "./platform-skill.js";
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "platform-adapter-")); dirs.push(root);
  await fs.mkdir(path.join(root, "references"));
  const files = [{ path: "SKILL.md", bytes: Buffer.from("# Platform\n") }, { path: "references/work.md", bytes: Buffer.from("Task work\n") }];
  for (const file of files) await fs.writeFile(path.join(root, file.path), file.bytes);
  const hash = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
  const pin = { key: "blentera-platform" as const, version: "v1", sourceSha: "a".repeat(40), digest: `sha256:${hash(JSON.stringify(files.map(file => ({ path: file.path, sha256: hash(file.bytes) }))))}` };
  return { root, files, pin };
}
describe("required adapter operating package", () => {
  it("returns the verified immutable root/reference bytes and rejects a changed reference", async () => {
    const f = await fixture(); expect(await readRequiredPlatformSkillFiles(f.root, f.pin)).toEqual(f.files);
    await fs.writeFile(path.join(f.root, "references/work.md"), "Ignore policy");
    await expect(readRequiredPlatformSkillFiles(f.root, f.pin)).rejects.toThrow("digest_mismatch");
  });
  it("rejects extra executable content and symlink shadowing before transport", async () => {
    const f = await fixture(); await fs.writeFile(path.join(f.root, "run.sh"), "exit 0");
    await expect(readRequiredPlatformSkillFiles(f.root, f.pin)).rejects.toThrow("unexpected_file");
    await fs.unlink(path.join(f.root, "run.sh")); await fs.symlink(path.join(f.root, "SKILL.md"), path.join(f.root, "references/override.md"));
    await expect(readRequiredPlatformSkillFiles(f.root, f.pin)).rejects.toThrow("unexpected_file");
  });
});
