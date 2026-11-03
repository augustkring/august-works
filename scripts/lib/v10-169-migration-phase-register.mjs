import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const allowedPromotions = new Set(['phase-index-only; no whole-program or production rollout qualification claimed']);
const requiredPhaseNames = [
  'add/expand', 'backfill/reconcile', 'cutover/drain', 'rollback/roll-forward',
  'restart/retry', 'restore', 'unknown_or_legacy_provenance',
];
const allowedPhaseStatuses = new Set([
  'source_and_selected_db_cases_exist', 'owner_specific_and_partial', 'operator_gate_open',
  'state_conditioned_documented', 'selected_actual_db_cases', 'selected_local_db_restore_cases',
  'deny_or_quarantine_unless_reconstructed',
]);

export function validateV10MigrationPhaseRegister({ repoRoot, register, journalEntries, affectedMigrationPaths }) {
  const errors = [];
  const fail = (message) => errors.push(message);
  const pinByPath = new Map((register.sourcePins ?? []).map((pin) => [pin.path, pin.sha256]));
  const journalByMigrationPath = new Map(journalEntries.map((entry) => [`packages/db/src/migrations/${entry.tag}.sql`, entry]));
  const affected = new Set(affectedMigrationPaths.filter((migrationPath) => migrationPath.endsWith('.sql')));
  const coveredIds = new Map();

  if (affected.size === 0) fail('source-base diff found no affected migration SQL');
  for (const migrationPath of affected) {
    const entry = journalByMigrationPath.get(migrationPath);
    if (!entry) fail(`affected migration is absent from current journal: ${migrationPath}`);
    if (!fs.existsSync(path.join(repoRoot, migrationPath))) fail(`affected migration source is missing: ${migrationPath}`);
    if (!pinByPath.has(migrationPath)) fail(`affected migration is not source-pinned: ${migrationPath}`);
  }

  for (const group of register.groups ?? []) {
    for (const id of group.migrations ?? []) {
      if (coveredIds.has(id)) fail(`migration ${id} appears in both ${coveredIds.get(id)} and ${group.id}`);
      coveredIds.set(id, group.id);
    }
    for (const migrationId of group.migrations ?? []) {
      const entry = journalEntries.find((candidate) => candidate.idx === migrationId);
      if (!entry) { fail(`${group.id} references migration absent from current journal: ${migrationId}`); continue; }
      const migrationPath = `packages/db/src/migrations/${entry.tag}.sql`;
      if (!affected.has(migrationPath)) fail(`${group.id} lists migration outside the source-base affected diff: ${migrationPath}`);
      if (!group.owners?.includes(migrationPath)) fail(`${group.id} does not list its migration owner ${migrationPath}`);
    }
    for (const field of ['purpose', 'authority', 'durableState', 'compatibility', 'recovery']) {
      if (!group[field] || (Array.isArray(group[field]) && group[field].length === 0)) fail(`${group.id} has no ${field}`);
    }
    if (!group.tests?.length) fail(`${group.id} has no exact database/test owner evidence`);
    for (const evidencePath of [...(group.owners ?? []), ...(group.tests ?? [])]) {
      if (!fs.existsSync(path.join(repoRoot, evidencePath))) fail(`${group.id} references missing owner/test ${evidencePath}`);
    }
  }
  for (const [migrationPath, entry] of journalByMigrationPath) {
    if (affected.has(migrationPath) && !coveredIds.has(entry.idx)) fail(`affected migration ${entry.idx} has no owner/phase group`);
  }
  for (const groupId of coveredIds.values()) if (!(register.groups ?? []).some((group) => group.id === groupId)) fail(`unknown owner group ${groupId}`);

  const phases = register.phaseCases ?? [];
  const phaseNames = phases.map((phase) => phase.phase);
  for (const requiredName of requiredPhaseNames) {
    const count = phaseNames.filter((phaseName) => phaseName === requiredName).length;
    if (count !== 1) fail(`required phase ${requiredName} must appear exactly once (found ${count})`);
  }
  for (const phaseName of phaseNames) if (!requiredPhaseNames.includes(phaseName)) fail(`unsupported extra phase ${phaseName}`);
  for (const phase of phases) {
    if (!phase.phase || !allowedPhaseStatuses.has(phase.status) || !phase.qualificationLimit || !phase.evidence?.length || !phase.cases?.length) fail(`incomplete or unsupported phase case ${phase.phase ?? '(unnamed)'}`);
    for (const evidencePath of phase.evidence ?? []) if (!fs.existsSync(path.join(repoRoot, evidencePath))) fail(`${phase.phase} references missing evidence ${evidencePath}`);
    for (const item of phase.cases ?? []) if (!item.path || !item.case || !fs.existsSync(path.join(repoRoot, item.path))) fail(`${phase.phase} has a missing concrete case reference`);
  }

  if (!allowedPromotions.has(register.promotion)) fail(`unsupported promotion ${register.promotion}`);
  for (const pending of register.pendingRows ?? []) {
    if (!pending.status?.includes('pending_private_not_published_not_qualified') || pending.sourcePin !== null || pending.evidence?.length !== 0) fail(`${pending.id} must remain explicitly unpublished/unqualified until source publication and evidence exist`);
    if (journalEntries.some((entry) => entry.idx === Number(pending.expectedMigration))) fail(`${pending.id} now appears in the official journal; refresh this register with source/owner/evidence before promoting it`);
  }

  for (const pin of register.sourcePins ?? []) {
    const fullPath = path.join(repoRoot, pin.path);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) { fail(`missing pinned file ${pin.path}`); continue; }
    const actual = crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex');
    if (actual !== pin.sha256) fail(`source pin changed: ${pin.path}`);
  }
  for (const group of register.groups ?? []) for (const evidencePath of [...(group.owners ?? []), ...(group.tests ?? [])]) if (!pinByPath.has(evidencePath)) fail(`${group.id} file is present but not source-pinned: ${evidencePath}`);
  for (const migrationPath of affected) {
    const fullPath = path.join(repoRoot, migrationPath);
    if (fs.existsSync(fullPath) && !pinByPath.has(migrationPath)) fail(`affected migration is not pinned: ${migrationPath}`);
  }

  const affectedEntries = [...affected].map((migrationPath) => journalByMigrationPath.get(migrationPath)).filter(Boolean).sort((a, b) => a.idx - b.idx);
  if (affectedEntries.length !== affected.size) fail('not every affected migration path resolves to a current journal entry');
  if (affectedEntries.length) {
    const first = affectedEntries[0];
    const last = affectedEntries.at(-1);
    if (register.officialMigrationInterval?.first !== first.idx || register.officialMigrationInterval?.last !== last.idx) fail('descriptive migration interval is stale relative to source-base diff');
    if (register.officialMigrationInterval?.latestOfficialMigration !== last.tag) fail('latest official migration tag is stale relative to source-base diff');
  }
  if (register.affectedMigrationDiscovery?.baseCommit !== register.sourceBaseCommit) fail('affected migration diff base does not match sourceBaseCommit');

  return errors;
}
