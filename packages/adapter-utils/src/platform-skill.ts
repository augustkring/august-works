import { createHash } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import type { AdapterExecutionContext } from "./types.js";

export type PlatformSkillFile = { path: string; bytes: Buffer };
/** Verify exactly the immutable operating package before any adapter installs
 * it. Return the verified bytes, so transport never re-reads mutable content. */
export async function readRequiredPlatformSkillFiles(source: string,
  pin: NonNullable<AdapterExecutionContext["platformSkillAdmission"]>): Promise<PlatformSkillFile[]> {
  if (pin.key !== "blentera-platform" || !/^sha256:[a-f0-9]{64}$/.test(pin.digest) ||
      !/^[a-f0-9]{40}$/.test(pin.sourceSha) || !pin.version) throw new Error("platform_skill_pin_invalid");
  const root = await fs.lstat(source);
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error("platform_skill_source_invalid");
  const files: PlatformSkillFile[] = [];
  let total = 0;
  async function walk(relative: string) {
    for (const entry of await fs.readdir(path.join(source, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory() && name === "references") { await walk(name); continue; }
      if (!entry.isFile() || name !== "SKILL.md" && !/^references\/[a-z0-9-]+\.md$/.test(name))
        throw new Error("platform_skill_unexpected_file");
      const handle = await fs.open(path.join(source, name), constants.O_RDONLY | constants.O_NOFOLLOW);
      let bytes: Buffer;
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > 128 * 1024) throw new Error("platform_skill_file_invalid");
        bytes = await handle.readFile();
      } finally { await handle.close(); }
      total += bytes.byteLength;
      if (files.length >= 64 || total > 4 * 1024 * 1024) throw new Error("platform_skill_package_too_large");
      files.push({ path: name, bytes });
    }
  }
  await walk("");
  files.sort((a, b) => a.path === "SKILL.md" ? -1 : b.path === "SKILL.md" ? 1 : a.path.localeCompare(b.path));
  if (files[0]?.path !== "SKILL.md") throw new Error("platform_skill_root_missing");
  const inventory = files.map(file => ({ path: file.path, sha256: createHash("sha256").update(file.bytes).digest("hex") }));
  const digest = `sha256:${createHash("sha256").update(JSON.stringify(inventory)).digest("hex")}`;
  if (digest !== pin.digest) throw new Error("platform_skill_digest_mismatch");
  return files;
}
