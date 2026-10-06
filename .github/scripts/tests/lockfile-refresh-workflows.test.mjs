import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const verificationWorkflows = [
  'pr-trusted', 'docker', 'aw-v4-verification', 'aw-v6-verification',
];

for (const name of verificationWorkflows) {
  test(`${name}: verify the committed graph without repair or mutable action refs`, async () => {
    const contents = await readFile(`.github/workflows/${name}.yml`, 'utf8');
    assert.match(contents, /pnpm install --frozen-lockfile/);
    assert.match(contents, /git diff --exit-code -- pnpm-lock.yaml/);
    assert.doesNotMatch(contents, /--no-frozen-lockfile|--resolution-only|git add pnpm-lock.yaml/);
    for (const [, ref] of contents.matchAll(/uses: ([^\s]+)/g)) {
      assert.match(ref, /^[^@]+@[a-f0-9]{40}$/, ref);
    }
    assert.match(contents, /node-version-file: .nvmrc/);
  });
}

test('lockfile refresh is manual, reviewed maintenance, not post-merge repair', async () => {
  const contents = await readFile('.github/workflows/refresh-lockfile.yml', 'utf8');
  assert.match(contents, /workflow_dispatch:/);
  assert.doesNotMatch(contents, /^  (push|schedule):/m);
  assert.doesNotMatch(contents, /gh pr merge/);
  assert.match(contents, /pnpm install --resolution-only --ignore-scripts --no-frozen-lockfile/);
});

test('PR workflow is bound to the caller repository and commit', async () => {
  const contents = await readFile('.github/workflows/pr.yml', 'utf8');
  assert.match(contents, /uses: \.\/\.github\/workflows\/pr-trusted.yml/);
  assert.doesNotMatch(contents, /@master|pull_request_target|secrets: inherit/);
});

test('SaaS image input graph must match both contract hash and source checkout', async () => {
  const contents = await readFile('.github/workflows/aw-v6-verification.yml', 'utf8');
  const images = contents.split('  immutable-images:')[1];
  assert.match(images, /sha256sum -c v6-dependency-graph.sha256\n\s+git diff --exit-code -- pnpm-lock.yaml/);
});
