#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const manifestPath = path.join(repoRoot, "evals", "aw-v4", "pilot-readiness.json");
const SECURITY_MANIFEST_PATH = "evals/aw-v4/security-gates.json";
const instanceSettingsPath = path.join(
  repoRoot,
  "packages",
  "shared",
  "src",
  "validators",
  "instance.ts",
);

const expectedSecurityGates = Array.from(
  { length: 18 },
  (_, index) => "SEC-" + String(index + 1).padStart(2, "0"),
);
const expectedEvalDomains = [
  "foundation",
  "connected_knowledge",
  "memory",
  "context",
  "workflows",
  "optimizer",
  "security",
];
const expectedDefaultOffFlags = [
  "enableFoundationV1",
  "enableContextEngineV1",
  "enableWorkflowsV1",
  "enableWorkflowBuilderV1",
  "enableWorkflowAgentNodes",
  "enableWorkflowExternalAgentNodes",
  "enableCollectiveMemoryV1",
  "enablePrivateAgentMemoryV1",
  "enableMemoryPostRunExtractionV1",
  "enableAutomationArtifactsV1",
  "enableAutomationArtifactCodeExecutionV1",
  "enableWorkflowOptimizerSuggestions",
  "enableWorkflowOptimizerShadow",
  "enableWorkflowOptimizerPromotion",
  "enableAiWorkflowAuthoring",
];

const expectedRestrictedPilotFlags = [
  "enableAutomationArtifactCodeExecutionV1",
  "enableWorkflowOptimizerPromotion",
];

const expectedManualChecks = [
  "migration_rehearsal",
  "tenant_security_review",
  "keyboard_accessibility",
  "drag_alternative",
  "approval_consequence_clarity",
  "control_plane_slo_baseline",
  "backup_restore_rehearsal",
  "feature_flag_rollout_and_rollback",
  "external_agent_scope_smoke",
  "customer_support_owner",
  "privacy_per_company_retention",
  "privacy_memory_deletion",
  "privacy_source_deletion_propagation",
  "privacy_derived_index_deletion",
  "privacy_sensitive_classification",
  "privacy_export_capability",
  "privacy_run_output_retention",
  "privacy_optimizer_trace_retention",
  "privacy_audit_access_control",
  "privacy_backup_restore_deletion_semantics",
];

function fail(message) {
  console.error("[aw-v4-pilot] " + message);
  process.exit(1);
}

function readJson(file, label) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(
      label +
        " is invalid JSON: " +
        (error instanceof Error ? error.message : String(error)),
    );
  }
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(label + " must be a non-empty string.");
  }
  return value.trim();
}

function httpsReference(value, label) {
  const reference = nonEmptyString(value, label);
  let parsed;
  try {
    parsed = new URL(reference);
  } catch {
    fail(label + " must be a valid HTTPS URL.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    fail(label + " must be a credential-free HTTPS URL.");
  }
  return reference;
}

function durableEvidenceReference(value, label) {
  const reference = nonEmptyString(value, label);
  if (/^https:\/\/\S+$/iu.test(reference)) {
    httpsReference(reference, label);
    return reference;
  }
  if (/^(?:artifact|s3|gs|azure|az|urn|ticket|run):(?:\/\/)?\S+$/iu.test(reference)) {
    return reference;
  }
  fail(
    label +
      " must be a durable evidence reference (HTTPS or a supported durable reference scheme).",
  );
}

function repositoryFile(relativePath) {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    path.isAbsolute(relativePath) ||
    relativePath.split("/").includes("..")
  ) {
    fail("Unsafe repository path: " + JSON.stringify(relativePath));
  }
  const absolute = path.resolve(repoRoot, relativePath);
  if (!absolute.startsWith(repoRoot + path.sep)) {
    fail("Repository path escapes root: " + relativePath);
  }
  if (!existsSync(absolute)) {
    fail("Required pilot evidence file does not exist: " + relativePath);
  }
  return absolute;
}

function exactStringSet(actual, expected, label) {
  if (!Array.isArray(actual)) fail(label + " must be an array.");
  if (actual.some((value) => typeof value !== "string")) {
    fail(label + " must contain strings only.");
  }
  if (new Set(actual).size !== actual.length) {
    fail(label + " contains duplicates.");
  }
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = expected.filter((value) => !actualSet.has(value));
  const extra = actual.filter((value) => !expectedSet.has(value));
  if (missing.length > 0 || extra.length > 0) {
    fail(
      label +
        " mismatch; missing=[" +
        missing.join(", ") +
        "] extra=[" +
        extra.join(", ") +
        "]",
    );
  }
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    fail(name + " requires a value.");
  }
  return value;
}

function currentCommitSha() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 10_000,
  });
  if (result.error || result.status !== 0) {
    fail("Could not resolve the repository commit for pilot evidence validation.");
  }
  const sha = result.stdout.trim();
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    fail("Repository HEAD did not resolve to a full Git commit SHA.");
  }
  return sha.toLowerCase();
}

function runSecurityCoverageCheck() {
  const result = spawnSync(
    process.execPath,
    ["scripts/check-aw-v4-security-eval-coverage.mjs"],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: process.env,
      timeout: 2 * 60 * 1000,
    },
  );
  if (result.error) {
    fail("Could not start security coverage check: " + result.error.message);
  }
  if (result.status !== 0) {
    fail("Security/eval coverage contract is not green.");
  }
}

if (!existsSync(manifestPath)) {
  fail("Missing evals/aw-v4/pilot-readiness.json.");
}
const manifest = readJson(manifestPath, "Pilot-readiness manifest");
if (manifest?.version !== 1) {
  fail("Pilot-readiness manifest version must be 1.");
}
if (manifest.securityManifest !== SECURITY_MANIFEST_PATH) {
  fail(
    "securityManifest must reference the canonical AW V4 security manifest: " +
      SECURITY_MANIFEST_PATH,
  );
}
repositoryFile(manifest.securityManifest);

exactStringSet(
  manifest.requiredSecurityGateIds,
  expectedSecurityGates,
  "requiredSecurityGateIds",
);
exactStringSet(
  manifest.requiredEvalDomains,
  expectedEvalDomains,
  "requiredEvalDomains",
);
exactStringSet(
  manifest.requiredManualChecks,
  expectedManualChecks,
  "requiredManualChecks",
);

exactStringSet(
  manifest.requiredDefaultOffFlags,
  expectedDefaultOffFlags,
  "requiredDefaultOffFlags",
);
exactStringSet(
  manifest.restrictedPilotFlags,
  expectedRestrictedPilotFlags,
  "restrictedPilotFlags",
);
for (const flag of manifest.restrictedPilotFlags) {
  if (!manifest.requiredDefaultOffFlags.includes(flag)) {
    fail("Restricted pilot flag is not governed default-off: " + flag);
  }
}

if (
  !manifest.featureFlagMetadata ||
  typeof manifest.featureFlagMetadata !== "object" ||
  Array.isArray(manifest.featureFlagMetadata)
) {
  fail("featureFlagMetadata must be an object.");
}
exactStringSet(
  Object.keys(manifest.featureFlagMetadata),
  manifest.requiredDefaultOffFlags,
  "featureFlagMetadata keys",
);
const knownFeatureFlags = new Set(manifest.requiredDefaultOffFlags);
for (const flag of manifest.requiredDefaultOffFlags) {
  const metadata = manifest.featureFlagMetadata[flag];
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    fail("Missing rollout metadata for feature flag: " + flag);
  }
  nonEmptyString(metadata.owner, "featureFlagMetadata[" + flag + "].owner");
  if (metadata.default !== false) {
    fail("featureFlagMetadata[" + flag + "].default must be false.");
  }
  nonEmptyString(metadata.scope, "featureFlagMetadata[" + flag + "].scope");
  if (
    !Array.isArray(metadata.dependencies) ||
    metadata.dependencies.some((value) => typeof value !== "string")
  ) {
    fail("featureFlagMetadata[" + flag + "].dependencies must be a string array.");
  }
  if (new Set(metadata.dependencies).size !== metadata.dependencies.length) {
    fail("featureFlagMetadata[" + flag + "].dependencies contains duplicates.");
  }
  for (const dependency of metadata.dependencies) {
    if (!knownFeatureFlags.has(dependency)) {
      fail("Feature flag " + flag + " references unknown dependency " + dependency + ".");
    }
    if (dependency === flag) {
      fail("Feature flag " + flag + " cannot depend on itself.");
    }
  }
  nonEmptyString(
    metadata.rollbackBehavior,
    "featureFlagMetadata[" + flag + "].rollbackBehavior",
  );
  const reviewDate = nonEmptyString(
    metadata.reviewDate,
    "featureFlagMetadata[" + flag + "].reviewDate",
  );
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewDate)) {
    fail("featureFlagMetadata[" + flag + "].reviewDate must be YYYY-MM-DD.");
  }
  nonEmptyString(
    metadata.cleanupCondition,
    "featureFlagMetadata[" + flag + "].cleanupCondition",
  );
}

const featureDependencyState = new Map();
function visitFeatureDependency(flag, ancestry = []) {
  const state = featureDependencyState.get(flag);
  if (state === "done") return;
  if (state === "visiting") {
    fail(
      "Feature flag dependency cycle detected: " +
        [...ancestry, flag].join(" -> "),
    );
  }
  featureDependencyState.set(flag, "visiting");
  for (const dependency of manifest.featureFlagMetadata[flag].dependencies) {
    visitFeatureDependency(dependency, [...ancestry, flag]);
  }
  featureDependencyState.set(flag, "done");
}
for (const flag of expectedDefaultOffFlags) {
  visitFeatureDependency(flag);
}

runSecurityCoverageCheck();

if (!existsSync(instanceSettingsPath)) {
  fail("Missing instance experimental settings schema.");
}
const instanceSettingsSource = readFileSync(instanceSettingsPath, "utf8");
for (const flag of manifest.requiredDefaultOffFlags) {
  const escaped = flag.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const pattern = new RegExp(
    escaped + "\\s*:\\s*z\\.boolean\\(\\)\\.default\\(false\\)",
  );
  if (!pattern.test(instanceSettingsSource)) {
    fail("Pilot feature flag is not explicitly default-off: " + flag);
  }
}

if (
  !Array.isArray(manifest.repositoryEvidence) ||
  manifest.repositoryEvidence.length === 0
) {
  fail("repositoryEvidence must be a non-empty array.");
}
const evidenceIds = new Set();
for (const entry of manifest.repositoryEvidence) {
  if (!entry || typeof entry !== "object") {
    fail("Malformed repositoryEvidence entry.");
  }
  const id = nonEmptyString(entry.id, "repositoryEvidence.id");
  if (evidenceIds.has(id)) {
    fail("Duplicate repository evidence id: " + id);
  }
  evidenceIds.add(id);
  const absolute = repositoryFile(
    nonEmptyString(entry.file, "repositoryEvidence[" + id + "].file"),
  );
  if (entry.contains !== undefined) {
    const contains = nonEmptyString(
      entry.contains,
      "repositoryEvidence[" + id + "].contains",
    );
    if (!readFileSync(absolute, "utf8").includes(contains)) {
      fail(
        "Repository evidence " +
          id +
          " is missing expected content in " +
          entry.file +
          ".",
      );
    }
  }
}

const requireEvidence = process.argv.includes("--require-evidence");
const evidenceArg = argumentValue("--evidence");
if (!evidenceArg) {
  if (requireEvidence) {
    fail("--require-evidence requires --evidence <file>.");
  }
  console.log(
    "[aw-v4-pilot] static contract valid: " +
      expectedSecurityGates.length +
      " security gates, " +
      expectedEvalDomains.length +
      " eval domains, " +
      manifest.requiredDefaultOffFlags.length +
      " default-off rollout flags, " +
      expectedManualChecks.length +
      " manual pilot checks.",
  );
  process.exit(0);
}

const pilotEvidencePath = path.resolve(process.cwd(), evidenceArg);
if (!existsSync(pilotEvidencePath)) {
  fail("Pilot evidence file does not exist: " + evidenceArg);
}
const evidence = readJson(pilotEvidencePath, "Pilot evidence");
if (evidence?.version !== 1) {
  fail("Pilot evidence version must be 1.");
}
nonEmptyString(evidence.environment, "environment");
if (
  typeof evidence.commitSha !== "string" ||
  !/^[0-9a-f]{40}$/i.test(evidence.commitSha)
) {
  fail("commitSha must be a full 40-character Git commit SHA.");
}
const repositoryCommitSha = currentCommitSha();
if (evidence.commitSha.toLowerCase() !== repositoryCommitSha) {
  fail(
    "Pilot evidence commitSha does not match repository HEAD; expected " +
      repositoryCommitSha +
      ".",
  );
}
const recordedAt = new Date(evidence.recordedAt);
if (
  typeof evidence.recordedAt !== "string" ||
  !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(
    evidence.recordedAt,
  ) ||
  Number.isNaN(recordedAt.getTime())
) {
  fail("recordedAt must be an explicit ISO-8601 timestamp with timezone.");
}
if (recordedAt.getTime() > Date.now() + 5 * 60 * 1000) {
  fail("recordedAt cannot be materially in the future.");
}

const automated = evidence.automated;
if (!automated || typeof automated !== "object") {
  fail("automated evidence is required.");
}
for (const key of [
  "repositoryTestsPassed",
  "typecheckBuildPassed",
  "securityGatesPassed",
  "behaviorEvalsPassed",
]) {
  if (automated[key] !== true) {
    fail("automated." + key + " must be true.");
  }
}
httpsReference(automated.ciRunUrl, "automated.ciRunUrl");
httpsReference(
  automated.securityGateRunUrl,
  "automated.securityGateRunUrl",
);
durableEvidenceReference(
  automated.behaviorEvalRunRef,
  "automated.behaviorEvalRunRef",
);

const migration = evidence.migration;
if (!migration || typeof migration !== "object") {
  fail("migration evidence is required.");
}
if (
  migration.cutoverReady !== true ||
  migration.repairableCount !== 0 ||
  migration.blockerCount !== 0
) {
  fail(
    "Migration evidence is not cutover-ready; require cutoverReady=true, repairableCount=0 and blockerCount=0.",
  );
}
durableEvidenceReference(migration.reportRef, "migration.reportRef");

const rollout = evidence.rollout;
if (!rollout || typeof rollout !== "object") {
  fail("rollout evidence is required.");
}
if (rollout.stage !== "pilot") {
  fail('rollout.stage must be "pilot".');
}
if (rollout.rollbackVerified !== true) {
  fail("rollout.rollbackVerified must be true.");
}
nonEmptyString(rollout.rollbackOwner, "rollout.rollbackOwner");
if (!Array.isArray(rollout.enabledFeatureFlags)) {
  fail("rollout.enabledFeatureFlags must be an array.");
}
if (
  rollout.enabledFeatureFlags.some((value) => typeof value !== "string") ||
  new Set(rollout.enabledFeatureFlags).size !==
    rollout.enabledFeatureFlags.length
) {
  fail("rollout.enabledFeatureFlags must contain unique strings.");
}
const governedFlags = new Set(manifest.requiredDefaultOffFlags);
if (rollout.enabledFeatureFlags.length === 0) {
  fail("rollout.enabledFeatureFlags must include at least one governed V4 feature.");
}
const enabledFeatureFlags = new Set(rollout.enabledFeatureFlags);
for (const flag of rollout.enabledFeatureFlags) {
  if (!governedFlags.has(flag)) {
    fail("Pilot rollout references unknown governed flag: " + flag);
  }
  const dependencies = manifest.featureFlagMetadata[flag]?.dependencies ?? [];
  for (const dependency of dependencies) {
    if (!enabledFeatureFlags.has(dependency)) {
      fail(
        "Enabled feature " +
          flag +
          " requires enabled dependency " +
          dependency +
          ".",
      );
    }
  }
}

const approvals = new Map();
if (evidence.highImpactApprovals !== undefined) {
  if (!Array.isArray(evidence.highImpactApprovals)) {
    fail("highImpactApprovals must be an array when supplied.");
  }
  for (const approval of evidence.highImpactApprovals) {
    if (!approval || typeof approval !== "object") {
      fail("Malformed highImpactApprovals entry.");
    }
    const flag = nonEmptyString(
      approval.flag,
      "highImpactApprovals.flag",
    );
    if (!manifest.restrictedPilotFlags.includes(flag)) {
      fail("High-impact approval references an unrestricted flag: " + flag);
    }
    if (approvals.has(flag)) {
      fail("Duplicate high-impact approval for " + flag + ".");
    }
    approvals.set(flag, approval);
  }
}
for (const flag of manifest.restrictedPilotFlags) {
  if (!rollout.enabledFeatureFlags.includes(flag)) continue;
  const approval = approvals.get(flag);
  if (!approval || approval.approved !== true) {
    fail("Enabled high-impact feature requires explicit approval: " + flag);
  }
  durableEvidenceReference(
    approval.evidence,
    "highImpactApprovals[" + flag + "].evidence",
  );
}

if (!Array.isArray(evidence.manualChecks)) {
  fail("manualChecks must be an array.");
}
const manual = new Map();
for (const check of evidence.manualChecks) {
  if (!check || typeof check !== "object") {
    fail("Malformed manualChecks entry.");
  }
  const id = nonEmptyString(check.id, "manualChecks.id");
  if (manual.has(id)) {
    fail("Duplicate manual check: " + id);
  }
  manual.set(id, check);
}
for (const id of expectedManualChecks) {
  const check = manual.get(id);
  if (!check) {
    fail("Missing manual pilot check: " + id);
  }
  if (check.status !== "passed") {
    fail("Manual pilot check is not passed: " + id);
  }
  durableEvidenceReference(
    check.evidence,
    "manualChecks[" + id + "].evidence",
  );
}
for (const id of manual.keys()) {
  if (!expectedManualChecks.includes(id)) {
    fail("Unknown manual pilot check: " + id);
  }
}

console.log(
  "[aw-v4-pilot] pilot evidence valid for repository HEAD " +
    evidence.commitSha +
    "; migration ready, rollback verified, and all manual C3/privacy checks passed.",
);
