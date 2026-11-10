import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { checkCustomerBrand, inspectSource } from './check-customer-brand.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'customer-brand-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (relative, contents) => {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  };
  write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
  write('scripts/customer-brand-compatibility.json', '[]\n');
  write('README.md', 'Blentera source tree.\n');
  write('cli/README.md', 'Use blentera --help.\n');
  write('cli/src/protocol-names.ts', 'const names = ["paperclipai", "PAPERCLIP_API_URL"];\n');
  write('ui/src/protocol-names.ts', 'const configKey = "PAPERCLIP_TELEMETRY_DISABLED";\n');
  write('ui/public/wordmark.svg', '<svg><text>Blentera</text></svg>\n');
  write('docs/docs.json', JSON.stringify({
    favicon: 'assets/favicon.svg',
    logo: { dark: 'assets/mark.svg', light: 'assets/mark.svg' },
    navigation: { languages: [{ language: 'en', pages: ['guide'] }] },
  }));
  write('docs/assets/favicon.svg', '<svg><text>Blentera</text></svg>\n');
  write('docs/assets/mark.svg', '<svg><text>Blentera</text></svg>\n');
  write('docs/guide.md', 'Blentera guide.\n');
  write('docs/help/export-and-delete.md', 'Blentera privacy guidance.\n');
  write('server/src/routes/email.ts', 'const subject = "Blentera notice";\n');
  return { root, write };
}

function writeExceptions(write, entries) {
  write('scripts/customer-brand-compatibility.json', `${JSON.stringify(entries, null, 2)}\n`);
}

test('gate detects public Help, CLI, email, SVG and shared runtime copy while preserving protocol identifiers', t => {
  const { root, write } = fixture(t);
  write('README.md', 'Upstream Paperclip project reference.\n');
  write('cli/README.md', 'Welcome August Works customers.\n');
  write('cli/src/commands/messages.ts', 'const startup = "Paperclip CLI is starting";\n');
  write('packages/shared/src/node-version.ts', 'export const warning = "Restart Paperclip after upgrading.";\n');
  write('docs/guide.md', 'Paperclip documentation.\n');
  write('docs/help/export-and-delete.md', 'Paperclip privacy guidance.\n');
  write('ui/public/wordmark.svg', '<svg><text>paperclip legacy wordmark</text></svg>\n');
  write('server/src/routes/email.ts', 'const subject = "Paperclip account notice";\n');

  const result = checkCustomerBrand(root);
  const files = new Set(result.violations.map(item => item.file));
  for (const file of ['README.md', 'cli/README.md', 'cli/src/commands/messages.ts', 'packages/shared/src/node-version.ts', 'docs/guide.md', 'docs/help/export-and-delete.md', 'ui/public/wordmark.svg', 'server/src/routes/email.ts'])
    assert.ok(files.has(file), `expected a public-copy finding in ${file}`);
  assert.ok(result.inventory.some(item => item.category === 'app_help_article' && item.file === 'docs/help/export-and-delete.md'));
  assert.ok(!files.has('cli/src/protocol-names.ts'));
  assert.ok(!files.has('ui/src/protocol-names.ts'));
});

test('a Markdown exception binds the full rendered line, so same-line copy changes fail closed', t => {
  const { root, write } = fixture(t);
  const original = 'Upstream Paperclip project reference.';
  write('README.md', `${original}\n`);
  writeExceptions(write, [{
    file: 'README.md', line: 1, sha256: sha256(original),
    category: 'upstream_project_attribution', reason: 'Identifies the upstream source project.',
  }]);
  let result = checkCustomerBrand(root);
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.staleExceptions, []);

  write('README.md', 'Welcome Paperclip, your Blentera workspace.\n');
  result = checkCustomerBrand(root);
  assert.ok(result.violations.some(item => item.file === 'README.md'));
  assert.equal(result.staleExceptions.length, 1);
});

test('an SVG exception binds the entire visible text node, not only the legacy word', t => {
  const { root, write } = fixture(t);
  const nodeText = 'paperclip upstream project wordmark';
  write('ui/public/wordmark.svg', `<svg><text>${nodeText}</text></svg>\n`);
  writeExceptions(write, [{
    file: 'ui/public/wordmark.svg', line: 1, sha256: sha256(nodeText),
    category: 'upstream_artifact_attribution', reason: 'Identifies the full visible SVG text node.',
  }]);
  let result = checkCustomerBrand(root);
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.staleExceptions, []);

  const changedText = 'paperclip customer welcome';
  write('ui/public/wordmark.svg', `<svg><text>${changedText}</text></svg>\n`);
  result = checkCustomerBrand(root);
  assert.ok(result.violations.some(item => item.file === 'ui/public/wordmark.svg'));
  assert.ok(result.staleExceptions.length >= 1);
});

test('brand gate reads customer strings and JSX while preserving technical identifiers and attribution comments', () => {
  const findings = inspectSource(`// Paperclip upstream attribution
import { LegacyPaperclip } from '@paperclipai/shared';
const PaperclipInternalOwner = 1;
const message = 'Paperclip needs a reviewer';
const label = <p>August Works account</p>;
const title = \`Welcome to Paperclip \${name}\`;
`, 'ui/src/example.tsx');
  assert.equal(findings.length, 3);
  assert.deepEqual(findings.map(value => value.line), [4, 5, 6]);
  assert.ok(findings.every(value => /^[0-9a-f]{64}$/.test(value.sha256)));
});

test('an AST string exception cannot authorize changed copy in the same literal', () => {
  const original = inspectSource('const label = "Paperclip Review";', 'ui/src/check.ts');
  const changed = inspectSource('const label = "Paperclip Review and new product copy";', 'ui/src/check.ts');
  assert.notEqual(original[0].sha256, changed[0].sha256);
  assert.equal(inspectSource('const label = PRODUCT_IDENTITY.productName;', 'ui/src/check.ts').length, 0);
});
