import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildComment, findExistingComment } from '../run-quality-gates.mjs';

test('findExistingComment: paginates until it finds the commitperclip comment', async () => {
  const seenPaths = [];
  const comment = await findExistingComment(async (path) => {
    seenPaths.push(path);
    if (path.endsWith('page=1')) {
      return Array.from({ length: 100 }, (_, index) => ({
        id: index + 1,
        user: { login: 'someone-else' },
        body: 'unrelated',
      }));
    }
    if (path.endsWith('page=2')) {
      return [{
        id: 200,
        user: { login: 'commitperclip[bot]' },
        body: 'Looks good.\n\n— commitperclip',
      }];
    }
    return [];
  }, 'token', 'paperclipai/paperclip', 6469);

  assert.equal(comment.id, 200);
  assert.deepEqual(seenPaths, [
    '/repos/paperclipai/paperclip/issues/6469/comments?per_page=100&page=1',
    '/repos/paperclipai/paperclip/issues/6469/comments?per_page=100&page=2',
  ]);
});

test('findExistingComment: returns null when no signed comment exists', async () => {
  const comment = await findExistingComment(async () => ([
    {
      id: 1,
      user: { login: 'commitperclip[bot]' },
      body: 'Unsigned status update',
    },
  ]), 'token', 'paperclipai/paperclip', 6469);

  assert.equal(comment, null);
});

test('workflow comments are reused only under the workflow bot and its signature', async () => {
  const body = buildComment('operator', ['Missing test'], [], 'github-actions[bot]');
  const comment = await findExistingComment(async () => ([
    { id: 1, user: { login: 'operator' }, body },
    { id: 2, user: { login: 'commitperclip[bot]' }, body },
    { id: 3, user: { login: 'github-actions[bot]' }, body: 'Another workflow comment' },
    { id: 4, user: { login: 'github-actions[bot]' }, body },
  ]), 'fixture_token', 'augustkring/august-works', 32, 'github-actions[bot]');
  assert.equal(comment.id, 4);
  assert.ok(body.includes('Missing test'));
  assert.ok(body.includes('<!-- paperclip-pr-quality-gates -->'));
  assert.ok(!body.includes('— commitperclip'));
});

test('workflow pagination does not select or overwrite an upstream app comment', async () => {
  const seenPaths = [];
  const body = buildComment('operator', [], [], 'github-actions[bot]');
  const comment = await findExistingComment(async path => {
    seenPaths.push(path);
    if (path.endsWith('page=1')) return Array.from({ length: 100 }, (_, index) => ({
      id: index, user: { login: 'commitperclip[bot]' }, body: '— commitperclip',
    }));
    return [{ id: 101, user: { login: 'github-actions[bot]' }, body }];
  }, 'fixture_token', 'augustkring/august-works', 32, 'github-actions[bot]');
  assert.equal(comment.id, 101);
  assert.equal(seenPaths.length, 2);
});

test('app mode preserves its signature and cannot select a workflow bot comment', async () => {
  const body = buildComment('operator', [], []);
  assert.ok(body.includes('— commitperclip'));
  const comment = await findExistingComment(async () => ([
    { id: 1, user: { login: 'github-actions[bot]' }, body },
    { id: 2, user: { login: 'commitperclip' }, body },
  ]), 'fixture_token', 'paperclipai/paperclip', 32);
  assert.equal(comment.id, 2);
});

test('unsupported comment authors are rejected before reading comments', async () => {
  await assert.rejects(findExistingComment(() => assert.fail('No API call expected'), 'fixture_token', 'augustkring/august-works', 32, 'operator'), /Unsupported/);
  assert.throws(() => buildComment('operator', [], [], 'operator'), /Unsupported/);
});
