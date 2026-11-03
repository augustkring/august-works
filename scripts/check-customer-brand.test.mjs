import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectSource } from './check-customer-brand.mjs';

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

test('an exception for one compatibility literal cannot authorize new copy', () => {
  const original = inspectSource('const label = "Paperclip Review";', 'ui/src/check.ts');
  const changed = inspectSource('const label = "Paperclip Review and new product copy";', 'ui/src/check.ts');
  assert.notEqual(original[0].sha256, changed[0].sha256);
  assert.equal(inspectSource('const label = PRODUCT_IDENTITY.productName;', 'ui/src/check.ts').length, 0);
});
