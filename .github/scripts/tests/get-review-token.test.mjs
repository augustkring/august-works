import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { resolveReviewAuthentication } from '../get-review-token.mjs';

const execFileAsync = promisify(execFile);

test('a fork without the app key uses its workflow token and own comment identity', async () => {
  const result = await resolveReviewAuthentication({ WORKFLOW_TOKEN: 'fixture_workflow_token' }, () => {
    assert.fail('The upstream app must not be contacted without a configured key.');
  });
  assert.deepEqual(result, { token: 'fixture_workflow_token', commentAuthor: 'github-actions[bot]' });
});

test('a configured app retains the installation token and app comment identity', async () => {
  const env = { COMMITPERCLIP_KEY: 'fixture_private_key', WORKFLOW_TOKEN: 'fixture_workflow_token' };
  const result = await resolveReviewAuthentication(env, async received => {
    assert.equal(received, env);
    return 'fixture_installation_token';
  });
  assert.deepEqual(result, { token: 'fixture_installation_token', commentAuthor: 'commitperclip[bot]' });
});

test('an invalid configured app cannot silently fall back to a workflow token', async () => {
  await assert.rejects(resolveReviewAuthentication({ COMMITPERCLIP_KEY: 'invalid', WORKFLOW_TOKEN: 'fixture_token' }, async () => {
    throw new Error('App authentication failed');
  }), /App authentication failed/);
});

test('missing or multiline tokens cannot create authentication outputs', async () => {
  for (const token of [undefined, '', 'fixture\ncomment_author=someone', 'fixture\rvalue=other']) {
    await assert.rejects(resolveReviewAuthentication({ WORKFLOW_TOKEN: token }), /valid app or workflow token/);
  }
});

test('the workflow CLI masks the token and records the matching bot identity', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'paperclip-review-token-'));
  try {
    const output = join(dir, 'outputs');
    const { stdout, stderr } = await execFileAsync(process.execPath, [fileURLToPath(new URL('../get-review-token.mjs', import.meta.url))], {
      env: { ...process.env, COMMITPERCLIP_KEY: '', WORKFLOW_TOKEN: 'fixture_workflow_token', GITHUB_OUTPUT: output },
    });
    assert.equal(stdout, '::add-mask::fixture_workflow_token\n');
    assert.equal(stderr, '');
    assert.equal(await readFile(output, 'utf8'), 'value=fixture_workflow_token\ncomment_author=github-actions[bot]\n');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the deployed workflow keeps dependency review and all gates in base-branch context', async () => {
  const workflow = await readFile(new URL('../../workflows/commitperclip-review.yml', import.meta.url), 'utf8');
  assert.match(workflow, /pull_request_target:/);
  assert.match(workflow, /ref: master/);
  assert.doesNotMatch(workflow, /^\s+ref:.*(?:head|refs\/pull)/m);
  assert.match(workflow, /WORKFLOW_TOKEN: \$\{\{ github.token \}\}/);
  assert.match(workflow, /COMMENT_AUTHOR: \$\{\{ steps.token.outputs.comment_author \}\}/);
  assert.match(workflow, /pull-requests: write/);
  assert.match(workflow, /contents: read/);
  assert.ok(workflow.indexOf('name: Dependency Review') < workflow.indexOf('name: Select review token'));
  assert.match(workflow, /run: node \.github\/scripts\/run-quality-gates.mjs/);
  assert.match(workflow, /steps.quality.outcome == 'failure'/);
  assert.match(workflow, /exit 1/);
});
