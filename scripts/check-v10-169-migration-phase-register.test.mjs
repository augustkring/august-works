import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateV10MigrationPhaseRegister } from './lib/v10-169-migration-phase-register.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const registerPath = path.join(repoRoot, 'doc/operations/aw-v10-evidence/v10-169-migration-phases-current-2026-10-30/phase-matrix.json');
const register = JSON.parse(fs.readFileSync(registerPath, 'utf8'));
const journal = JSON.parse(fs.readFileSync(path.join(repoRoot, register.officialMigrationInterval.journalSource), 'utf8'));
const diff = execFileSync('git', ['diff', '--name-status', register.sourceBaseCommit, '--', 'packages/db/src/migrations'], { cwd: repoRoot, encoding: 'utf8' });
const baseJournal = JSON.parse(execFileSync('git', ['show', `${register.sourceBaseCommit}:packages/db/src/migrations/meta/_journal.json`], { cwd: repoRoot, encoding: 'utf8' }));
const baseTags = new Set(baseJournal.entries.map((entry) => entry.tag));
const affectedMigrationPaths = new Set(diff.split('\n').filter(Boolean).flatMap((line) => {
  const parts = line.split('\t');
  const status = parts[0];
  const candidate = status.startsWith('R') || status.startsWith('C') ? parts.at(-1) : parts[1];
  return candidate?.startsWith('packages/db/src/migrations/') && candidate.endsWith('.sql') && !status.startsWith('D') ? [candidate] : [];
}));
for (const entry of journal.entries) if (!baseTags.has(entry.tag)) affectedMigrationPaths.add(`packages/db/src/migrations/${entry.tag}.sql`);
const validate = (candidate) => validateV10MigrationPhaseRegister({ repoRoot, register: candidate, journalEntries: journal.entries, affectedMigrationPaths: [...affectedMigrationPaths] });
const clone = () => structuredClone(register);

test('accepts the source-pinned current affected migration and owner inventory', () => {
  assert.deepEqual(validate(register), []);
});

test('rejects omission of an affected migration from its owner group', () => {
  const candidate = clone();
  const group = candidate.groups[0];
  group.migrations.pop();
  const errors = validate(candidate);
  assert.ok(errors.some((error) => error.includes('has no owner/phase group')));
});

test('rejects an affected migration whose group omits its SQL owner path', () => {
  const candidate = clone();
  const group = candidate.groups[0];
  const id = group.migrations[0];
  const entry = journal.entries.find((item) => item.idx === id);
  const migrationPath = `packages/db/src/migrations/${entry.tag}.sql`;
  group.owners = group.owners.filter((owner) => owner !== migrationPath);
  assert.ok(validate(candidate).some((error) => error.includes('does not list its migration owner')));
});

test('rejects a stale source pin', () => {
  const candidate = clone();
  candidate.sourcePins[0].sha256 = '0'.repeat(64);
  assert.ok(validate(candidate).some((error) => error.includes('source pin changed')));
});

test('rejects omission or duplication of any required migration phase', () => {
  const omitted = clone();
  omitted.phaseCases = omitted.phaseCases.filter((phase) => phase.phase !== 'restore');
  assert.ok(validate(omitted).some((error) => error.includes('required phase restore must appear exactly once')));

  const duplicated = clone();
  duplicated.phaseCases.push(structuredClone(duplicated.phaseCases[0]));
  assert.ok(validate(duplicated).some((error) => error.includes('required phase add/expand must appear exactly once')));
});

test('rejects unsupported qualified promotion', () => {
  const candidate = clone();
  candidate.promotion = 'qualified';
  assert.ok(validate(candidate).some((error) => error.includes('unsupported promotion')));
});
