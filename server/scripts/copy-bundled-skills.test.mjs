import { test } from 'vitest';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPlatformSkillRelease } from './copy-bundled-skills.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
async function fixture(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'blentera-platform-package-test-'));
  try { await cp(path.join(root, 'skills-releases'), path.join(dir, 'skills-releases'), { recursive: true }); await run(dir); }
  finally { await rm(dir, { recursive: true, force: true }); }
}
test('the shipped platform artifact verifies with a real source commit and every focused reference', async () => {
  const [release] = await verifyPlatformSkillRelease(root);
  assert.equal(release.files.length, 14);
  assert.equal(release.mutableByCustomer, false);
  assert.match(release.sourceSha, /^[a-f0-9]{40}$/);
});
test('changed procedure bytes and extra unreviewed references fail artifact verification', async () => {
  await fixture(async dir => {
    const base = path.join(dir, 'skills-releases/blentera-platform/v1');
    await writeFile(path.join(base, 'references/work.md'), '# Changed instruction\n');
    await assert.rejects(verifyPlatformSkillRelease(dir), /digest mismatch/);
  });
  await fixture(async dir => {
    await writeFile(path.join(dir, 'skills-releases/blentera-platform/v1/references/unreviewed.md'), '# Extra\n');
    await assert.rejects(verifyPlatformSkillRelease(dir), /digest mismatch/);
  });
});
test('symlinked procedure content cannot escape the promoted artifact', async () => {
  await fixture(async dir => {
    const reference = path.join(dir, 'skills-releases/blentera-platform/v1/references/work.md');
    await rm(reference); await symlink(path.join(root, 'skills/blentera-platform/references/work.md'), reference);
    await assert.rejects(verifyPlatformSkillRelease(dir), /regular files/);
  });
});
test('customer-mutable or unpinned releases cannot be packaged', async () => {
  await fixture(async dir => {
    const registry = path.join(dir, 'skills-releases/blentera-platform/releases.json');
    const releases = JSON.parse(await readFile(registry, 'utf8'));
    releases[0].mutableByCustomer = true;
    await writeFile(registry, JSON.stringify(releases));
    await assert.rejects(verifyPlatformSkillRelease(dir), /Invalid platform Skill release/);
  });
});
