import { cp, mkdir, readFile, readdir, rm, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const server = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.dirname(server);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

// Verify the promoted platform artifact before packaging it. The editable
// source and immutable release are different lifecycle stages, never fallback
// sources for one another at runtime.
export async function verifyPlatformSkillRelease(repositoryRoot = root) {
  const releasesRoot = path.join(repositoryRoot, 'skills-releases/blentera-platform');
  const releases = JSON.parse(await readFile(path.join(releasesRoot, 'releases.json'), 'utf8'));
  if (!Array.isArray(releases) || releases.length === 0) throw Error('Missing platform Skill release');
  for (const release of releases) {
    if (release.skillKey !== 'blentera-platform' || release.mutableByCustomer !== false || !/^[a-f0-9]{40}$/.test(release.sourceSha ?? '') || !/^[a-zA-Z0-9_-]+$/.test(release.dir ?? '') || !Array.isArray(release.files) || !/^[a-f0-9]{64}$/.test(release.operationManifestHash ?? '') || !/^[a-f0-9]{64}$/.test(release.toolCatalogContractHash ?? '')) throw Error('Invalid platform Skill release');
    const directory = path.join(releasesRoot, release.dir), files = [];
    async function walk(dir) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const filename = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(filename);
        else if (entry.isFile()) {
          const relative = path.relative(directory, filename).split(path.sep).join('/');
          if (relative !== 'SKILL.md' && !/^references\/[a-z0-9-]+\.md$/.test(relative)) throw Error('Unexpected platform Skill artifact');
          const bytes = await readFile(filename);
          if (bytes.length > 128 * 1024 || files.length >= 64) throw Error('Platform Skill exceeds package bound');
          files.push({ path: relative, sha256: hash(bytes) });
        } else throw Error('Platform Skill artifact must contain regular files');
      }
    }
    await walk(directory);
    files.sort((a, b) => a.path === 'SKILL.md' ? -1 : b.path === 'SKILL.md' ? 1 : a.path.localeCompare(b.path));
    const contentDigest = `sha256:${hash(JSON.stringify(files))}`;
    if (contentDigest !== release.contentDigest || JSON.stringify(files) !== JSON.stringify(release.files)) throw Error('Platform Skill release digest mismatch');
  }
  return releases;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyPlatformSkillRelease();
  if (!process.argv.includes('--check-source')) {
    for (const name of ['skills', 'skills-releases']) {
      const staging = path.join(server, `.bundled-${name}-${randomUUID()}`);
      try {
        await mkdir(staging);
        await cp(path.join(root, name), staging, { recursive: true, dereference: false });
        await rm(path.join(server, name), { recursive: true, force: true });
        await rename(staging, path.join(server, name));
      } finally { await rm(staging, { recursive: true, force: true }); }
    }
  }
  console.log('Bundled operating Skills and immutable platform release verified');
}
