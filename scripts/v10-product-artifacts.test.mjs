import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));

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

test("0554 Safe Change graph pins exact source bytes without inventing release or operator evidence", () => {
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
  assert.ok(graph.edges.some((edge) => edge.from === "0554_company_import_fenced_effects.sql" && edge.to === "0556_customer_operation_expired_lease_recovery.sql"));
  assert.equal(record.sources.find((source) => source.path.endsWith("0554_company_import_fenced_effects.sql"))?.sha256,
    createHash("sha256").update(readFileSync(resolve(root, "packages/db/src/migrations/0554_company_import_fenced_effects.sql"))).digest("hex"));
});
