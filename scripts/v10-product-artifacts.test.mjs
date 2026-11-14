import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildGraph } from "./generate-v10-safe-change-graph.mjs";

const root = resolve(import.meta.dirname, "..");
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));

test("Safe Change rejects a base comparison from another commit", () => {
  const manifest = {
    sourceBase: { commitSha: "a".repeat(40) },
    changes: [{ changeId: "example", sourcePaths: ["source.ts"], sourceBeforePins: [{
      path: "source.ts", baseCommitSha: "b".repeat(40), status: "absent_at_base", sha256: null,
    }] }],
  };
  assert.throws(() => buildGraph(manifest, () => Buffer.from("source"), () => true), /does not match the declared source base/);
  assert.throws(() => buildGraph({ ...manifest, sourceBase: {} }), /exact 40-character source base commit/);
});

test("capability projection joins source catalog rows without upgrading their qualification", () => {
  const projection = readJson("doc/operations/v10-capability-projection.json");
  assert.equal(projection.requirement, "V10-002");
  assert.ok(projection.features.length > 0);
  assert.equal(new Set(projection.features.map((row) => row.id)).size, projection.features.length);
  assert.ok(projection.features.some((row) => row.ownerDisposition === "unknown" && row.declaredOwner === null));
  assert.ok(projection.experienceSurfaces.some((row) => row.qualification === "inherited_coverage_status_not_release_acceptance"));
  const coverage = readJson("doc/experience/v9/coverage.json");
  for (const screen of coverage.screens) {
    assert.deepEqual(projection.experienceSurfaces.find((row) => row.id === `screen:${screen.screenId}`)?.sourcePaths, screen.componentPaths ?? []);
  }
  assert.ok(projection.agentNativeOperations.every((row) => row.qualification === "operation_mapping_not_capability_readiness"));
  assert.equal(projection.sourceInputs.find((row) => row.path === "doc/experience/v9/coverage.json")?.sha256,
    createHash("sha256").update(readFileSync(resolve(root, "doc/experience/v9/coverage.json"))).digest("hex"));
});

test("0554 Safe Change record preserves a passing source test while leaving production qualification open", () => {
  const graph = readJson("doc/operations/v10-safe-change-graph.json");
  const record = graph.nodes.find((node) => node.id === "SCR-V10-0554-company-import-lease-budget");
  assert.ok(record);
  assert.equal(graph.sourceIdentity.releaseQualification, "not_claimed");
  assert.equal(record.decisionOwner, null);
  assert.equal(record.decisionOwnerDisposition, "unknown_until_the_database_release_owner_is_named");
  assert.equal(record.currentFacts.populationCount, null);
  assert.match(record.qualification.sourceTestResult, /^4\/4 embedded-Postgres tests passed on snapshot /);
  assert.match(record.qualification.remaining, /production-qualified/);
  assert.equal(record.sourceBefore.commitSha, "d53236bb50f800275794fb955683e6256b192a4b");
  assert.equal(record.preservedHistoricalMigration.sha256,
    createHash("sha256").update(readFileSync(resolve(root, record.preservedHistoricalMigration.path))).digest("hex"));
  assert.ok(graph.edges.some((edge) => edge.from === "0554_company_import_fenced_effects" && edge.to === "0555_company_membership_permission_initialization" && edge.relation === "drizzle_journal_order_only"));
  assert.ok(graph.edges.some((edge) => edge.from === "0555_company_membership_permission_initialization" && edge.to === "0556_customer_operation_expired_lease_recovery" && edge.relation === "drizzle_journal_order_only"));
  assert.equal(record.sources.find((source) => source.path.endsWith("0554_company_import_fenced_effects.sql"))?.sha256,
    createHash("sha256").update(readFileSync(resolve(root, "packages/db/src/migrations/0554_company_import_fenced_effects.sql"))).digest("hex"));
});

test("V10-004 inventories every branch source delta and cross-references all brief work IDs without asserting closure", () => {
  const graph = readJson("doc/operations/v10-safe-change-graph.json");
  const requirementIds = graph.requirementsCrosswalk.map((row) => row.workId);
  assert.equal(graph.schemaVersion, 2);
  assert.equal(new Set(requirementIds).size, 169);
  assert.deepEqual(requirementIds.slice().sort(), Array.from({ length: 169 }, (_, index) => `V10-${String(index + 1).padStart(3, "0")}`).sort());
  assert.equal(graph.nodes.filter((node) => node.kind === "safe_change_record" && node.recordKind === "production_hotspot_owner_group").length, 25);
  assert.equal(graph.nodes.filter((node) => node.kind === "journaled_migration_source").length, graph.migrationJournal.entryCount);
  assert.ok(graph.sourceInventoryBoundary.sourceDeltaPathCount > 1500);
  assert.equal(graph.sourceIdentity.baseCommitSha, "81d3445b98b1cd80ff400ede6bd44ea71d88d735");
  assert.equal(graph.sourceIdentity.releaseQualification, "not_claimed");
  assert.ok(graph.requirementsCrosswalk.every((row) => row.acceptanceStatus === "unchanged_from_requirement_reconciliation_register"));
  assert.ok(graph.requirementsCrosswalk.some((row) => row.workId === "V10-074" && row.safeChangeIds.includes("SCR-V10-MODEL-PROVIDER-AND-MIGRATION-MONITOR")));
  assert.ok(graph.requirementsCrosswalk.some((row) => row.workId === "V10-169"));
  const records = graph.nodes.filter((node) => node.kind === "safe_change_record");
  assert.ok(records.every((node) => Array.isArray(node.dependencyIds)));
  const manifest = readJson("doc/operations/v10-safe-change-graph.source.json");
  for (const change of manifest.changes.filter((row) => typeof row.dependencies === "string")) {
    assert.equal(records.find((node) => node.id === change.changeId)?.dependencies, change.dependencies);
  }
});
