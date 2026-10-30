import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildFeatureCatalogArtifactV2 } from "../packages/shared/src/feature-catalog.js";

interface CatalogEntry {
  id: string;
  key?: string;
  name: string;
  kind: string;
  category?: string;
}
interface PackageCatalog {
  packageName: string;
  packageVersion: string;
  teams?: CatalogEntry[];
  skills?: CatalogEntry[];
}
interface ExperienceScreen {
  screenId: string;
  journeyId: string;
  criticality: string;
  owner?: string | null;
  implementationStatus?: string;
  contractPath?: string | null;
  componentPaths?: string[];
  evidenceRefs?: string[];
}
interface ExperienceCoverage { screens?: ExperienceScreen[] }
interface OperationRow {
  operationId: string;
  disposition: string;
  canonicalOwner?: string | null;
  uiSource: string;
  sourceAnchor: string;
}
interface UiOnlyAction {
  actionId: string;
  owner?: string | null;
  source: string;
  sourceAnchor: string;
}
interface OperationCoverage {
  operations?: OperationRow[];
  uiOnlyActions?: UiOnlyAction[];
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutput = "doc/operations/v10-capability-projection.json";
const inputPaths = [
  "packages/shared/src/feature-catalog.ts",
  "packages/teams-catalog/generated/catalog.json",
  "packages/skills-catalog/generated/catalog.json",
  "doc/experience/v9/coverage.json",
  "doc/operations/agent-native-ui-operation-coverage.json",
] as const;

async function json<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(resolve(root, path), "utf8")) as T;
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(resolve(root, path))).digest("hex");
}

function parseArgs(): { output: string; check: boolean } {
  const args = process.argv.slice(2);
  let output = defaultOutput;
  let check = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--out") output = args[++i] ?? "";
    else if (args[i] === "--check") check = true;
    else throw new Error(`Unknown argument: ${args[i]}`);
  }
  if (!output) throw new Error("--out requires a path");
  return { output, check };
}

const { output, check } = parseArgs();
const [teams, skills, experience, operations] = await Promise.all([
  json<PackageCatalog>(inputPaths[1]), json<PackageCatalog>(inputPaths[2]),
  json<ExperienceCoverage>(inputPaths[3]), json<OperationCoverage>(inputPaths[4]),
]);
const features = buildFeatureCatalogArtifactV2("working-tree").features;
const artifacts = Object.entries(features).map(([key, feature]) => ({
  id: `feature:${key}`,
  kind: "feature_flag",
  source: inputPaths[0],
  name: feature.title,
  description: feature.description,
  declaredOwner: feature.lifecycle.owner,
  ownerDisposition: feature.lifecycle.owner ? "declared_in_feature_catalog" : "unknown",
  maturity: feature.lifecycle.maturity,
  tier: feature.tier,
  lifecycle: feature.lifecycle,
  qualification: "catalog_metadata_only",
}));
const surfaces = (experience.screens ?? []).map((screen) => ({
  id: `screen:${screen.screenId}`,
  kind: "experience_surface",
  source: "doc/experience/v9/coverage.json",
  journeyId: screen.journeyId,
  criticality: screen.criticality,
  declaredOwner: screen.owner || null,
  ownerDisposition: screen.owner ? "declared_in_inherited_register" : "unknown",
  implementationStatus: screen.implementationStatus,
  contractPath: screen.contractPath,
  sourcePaths: screen.componentPaths ?? [],
  evidenceRefs: screen.evidenceRefs ?? [],
  qualification: "inherited_coverage_status_not_release_acceptance",
}));
const nativeOperations = [
  ...(operations.operations ?? []).map((row) => ({
    id: row.operationId, kind: "agent_native_operation", source: "doc/operations/agent-native-ui-operation-coverage.json",
    disposition: row.disposition, canonicalOwner: row.canonicalOwner || null,
    ownerDisposition: row.canonicalOwner ? "declared" : "unknown", uiSource: row.uiSource,
    sourceAnchor: row.sourceAnchor, qualification: "operation_mapping_not_capability_readiness",
  })),
  ...(operations.uiOnlyActions ?? []).map((row) => ({
    id: row.actionId, kind: "human_ui_action", source: "doc/operations/agent-native-ui-operation-coverage.json",
    disposition: "human_ui_only", canonicalOwner: row.owner || null,
    ownerDisposition: row.owner ? "declared" : "unknown", uiSource: row.source,
    sourceAnchor: row.sourceAnchor, qualification: "operation_mapping_not_capability_readiness",
  })),
];
const packageCatalogs = [
  { id: "teams", path: inputPaths[1], rows: teams.teams ?? [] },
  { id: "skills", path: inputPaths[2], rows: skills.skills ?? [] },
].map(({ id, path, rows }) => ({
  catalogId: id,
  source: path,
  packageName: id === "teams" ? teams.packageName : skills.packageName,
  packageVersion: id === "teams" ? teams.packageVersion : skills.packageVersion,
  entries: rows.map((row) => ({ id: row.id, key: row.key, name: row.name, kind: row.kind, category: row.category })),
  qualification: "package_catalog_entry_only",
}));
const sourceInputs = await Promise.all(inputPaths.map(async (path) => ({ path, sha256: await sha256(path) })));
const artifact = {
  schemaVersion: 1,
  artifact: "V10 product capability projection",
  requirement: "V10-002",
  sourceIdentity: "working-tree; hashes identify inputs, not a release artifact",
  qualificationBoundary: "This is a deterministic join of existing feature, package, experience and Agent-Native catalogs. It does not infer capability availability, readiness, external support, owners absent from source, or release acceptance.",
  sourceInputs,
  inputDisposition: [
    { path: inputPaths[0], usedFor: "feature lifecycle metadata via buildFeatureCatalogArtifactV2" },
    { path: inputPaths[1], usedFor: "team package catalog entries only" },
    { path: inputPaths[2], usedFor: "skill package catalog entries only" },
    { path: inputPaths[3], usedFor: "inherited experience surface and journey references; qualification remains inherited and open" },
    { path: inputPaths[4], usedFor: "Agent-Native operations and explicit Human-only UI actions", excludedFields: ["clientOperations", "nonMaterialUiSources"], exclusionReason: "Callsite-level client inventory is not a product capability catalog and remains in its existing authoritative inventory." },
  ],
  features: artifacts,
  experienceSurfaces: surfaces,
  agentNativeOperations: nativeOperations,
  packageCatalogs,
};
const rendered = `${JSON.stringify(artifact, null, 2)}\n`;
const destination = resolve(root, output);
if (check) {
  const existing = await readFile(destination, "utf8");
  if (existing !== rendered) throw new Error(`${output} is stale; regenerate from current catalog inputs`);
} else if (output === "-") {
  process.stdout.write(rendered);
} else {
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, rendered, "utf8");
}
