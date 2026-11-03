import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('published command aliases share the canonical entrypoint and preserve legacy arguments, output and exit code', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../cli/package.json', import.meta.url), 'utf8'));
  assert.equal(packageJson.bin.blentera, './dist/index.js');
  assert.equal(packageJson.bin.paperclipai, './bin/paperclipai.mjs');
  assert.ok(packageJson.files.includes('bin'));
  const root = await mkdtemp(path.join(tmpdir(), 'blentera-cli-alias-'));
  try {
    await mkdir(path.join(root, 'bin')); await mkdir(path.join(root, 'dist'));
    await copyFile(new URL('../cli/bin/paperclipai.mjs', import.meta.url), path.join(root, 'bin/paperclipai.mjs'));
    await writeFile(path.join(root, 'dist/index.js'), 'console.log(JSON.stringify(process.argv.slice(2)));process.exitCode=7;');
    const result = spawnSync(process.execPath, [path.join(root, 'bin/paperclipai.mjs'), 'company', 'import', 'a folder', '--json'], { encoding: 'utf8' });
    assert.equal(result.status, 7);
    assert.deepEqual(JSON.parse(result.stdout), ['company', 'import', 'a folder', '--json']);
    assert.equal(result.stderr.trim().split('\n').length, 1);
    assert.match(result.stderr, /use blentera.*2027-04-27.*https:\/\/docs\.blentera\.com\/cli\/migration/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
