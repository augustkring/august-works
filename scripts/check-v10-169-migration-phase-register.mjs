#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateV10MigrationPhaseRegister } from './lib/v10-169-migration-phase-register.mjs';

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const registerArg = args.find((arg) => arg.startsWith('--register='))?.slice('--register='.length);
const repoRoot = path.resolve(args.find((arg) => arg.startsWith('--root='))?.slice('--root='.length) ?? scriptRoot);
const registerPath = path.resolve(repoRoot, registerArg ?? 'doc/operations/aw-v10-evidence/v10-169-migration-phases-current-2026-10-30/phase-matrix.json');
const register = JSON.parse(fs.readFileSync(registerPath, 'utf8'));
const journal = JSON.parse(fs.readFileSync(path.join(repoRoot, register.officialMigrationInterval.journalSource), 'utf8'));
const diff = execFileSync('git', ['diff', '--name-status', register.sourceBaseCommit, '--', 'packages/db/src/migrations'], { cwd: repoRoot, encoding: 'utf8' });
const baseJournal = JSON.parse(execFileSync('git', ['show', `${register.sourceBaseCommit}:packages/db/src/migrations/meta/_journal.json`], { cwd: repoRoot, encoding: 'utf8' }));
const baseTags = new Set(baseJournal.entries.map((entry) => entry.tag));
const affectedMigrationPaths = new Set();
for (const line of diff.split('\n').filter(Boolean)) {
  const parts = line.split('\t');
  const status = parts[0];
  const candidate = status.startsWith('R') || status.startsWith('C') ? parts.at(-1) : parts[1];
  if (candidate?.startsWith('packages/db/src/migrations/') && candidate.endsWith('.sql') && !status.startsWith('D')) affectedMigrationPaths.add(candidate);
}
// Include newly journaled SQL even when its source is still an untracked publication payload.
for (const entry of journal.entries) if (!baseTags.has(entry.tag)) affectedMigrationPaths.add(`packages/db/src/migrations/${entry.tag}.sql`);
const errors = validateV10MigrationPhaseRegister({ repoRoot, register, journalEntries: journal.entries, affectedMigrationPaths: [...affectedMigrationPaths] });
if (errors.length) {
  for (const error of errors) console.error(`V10-169 phase register: ${error}`);
  process.exitCode = 1;
} else {
  console.log(`V10-169 migration register valid: ${affectedMigrationPaths.size} source-base-diff/journal-delta migrations covered by ${register.groups.length} owner groups; current source hashes match; no unsupported promotion.`);
}
