#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const manifestPath = path.join(repoRoot, "evals", "aw-v4", "security-gates.json");

const expectedGates = new Map([
  ["SEC-01", "tenant_isolation"],
  ["SEC-02", "foundation_authorization"],
  ["SEC-03", "memory_authorization"],
  ["SEC-04", "private_agent_memory_isolation"],
  ["SEC-05", "connector_acl"],
  ["SEC-06", "permission_revocation"],
  ["SEC-07", "memory_lifecycle_exclusion"],
  ["SEC-08", "untrusted_content_cannot_change_authority"],
  ["SEC-09", "untrusted_content_cannot_activate_shared_memory"],
  ["SEC-10", "generated_code_sandbox"],
  ["SEC-11", "secret_non_disclosure"],
  ["SEC-12", "destructive_action_approval"],
  ["SEC-13", "workflow_retry_side_effect_idempotency"],
  ["SEC-14", "external_agent_scope"],
  ["SEC-15", "context_manifest_no_secret_values"],
  ["SEC-16", "memory_rollback"],
  ["SEC-17", "workflow_rollback_and_recovery"],
  ["SEC-18", "optimizer_promotion_reversible"],
]);

const behaviorRequired = new Set([
  "SEC-01",
  "SEC-05",
  "SEC-06",
  "SEC-08",
  "SEC-09",
  "SEC-11",
  "SEC-12",
  "SEC-13",
  "SEC-18",
]);

function fail(message) {
  console.error(`[aw-v4-security] ${message}`);
  process.exit(1);
}

function repoFile(relativePath) {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    path.isAbsolute(relativePath) ||
    relativePath.split("/").includes("..")
  ) {
    fail(`Unsafe or empty repository path: ${JSON.stringify(relativePath)}`);
  }
  const absolute = path.resolve(repoRoot, relativePath);
  if (!absolute.startsWith(`${repoRoot}${path.sep}`)) {
    fail(`Path escapes repository root: ${relativePath}`);
  }
  if (!existsSync(absolute)) {
    fail(`Referenced security-eval file does not exist: ${relativePath}`);
  }
  return absolute;
}

if (!existsSync(manifestPath)) fail("Missing evals/aw-v4/security-gates.json.");

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (error) {
  fail(`Security-gate manifest is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
}

if (manifest?.version !== 2 || !Array.isArray(manifest?.gates)) {
  fail("Security-gate manifest must be version 2 with a gates array.");
}

const expectedEvalDomains = new Set([
  "foundation",
  "connected_knowledge",
  "memory",
  "context",
  "workflows",
  "optimizer",
  "security",
]);
if (!Array.isArray(manifest.evalDomains) || manifest.evalDomains.length !== expectedEvalDomains.size) {
  fail(`Expected ${expectedEvalDomains.size} eval domains, found ${Array.isArray(manifest.evalDomains) ? manifest.evalDomains.length : 0}.`);
}

if (manifest.gates.length !== expectedGates.size) {
  fail(`Expected ${expectedGates.size} security gates, found ${manifest.gates.length}.`);
}

const seenIds = new Set();
const deterministicSuites = new Set();
let behaviorMetricCount = 0;

for (const gate of manifest.gates) {
  if (!gate || typeof gate !== "object") fail("Every security gate must be an object.");
  const expectedName = expectedGates.get(gate.id);
  if (!expectedName) fail(`Unknown security gate id: ${String(gate.id)}`);
  if (seenIds.has(gate.id)) fail(`Duplicate security gate id: ${gate.id}`);
  seenIds.add(gate.id);
  if (gate.name !== expectedName) {
    fail(`Gate ${gate.id} must be named ${expectedName}, found ${String(gate.name)}.`);
  }
  if (!Array.isArray(gate.deterministicTests) || gate.deterministicTests.length === 0) {
    fail(`Gate ${gate.id} requires at least one deterministic test suite.`);
  }
  for (const evidence of gate.deterministicTests) {
    if (
      !evidence ||
      typeof evidence !== "object" ||
      typeof evidence.file !== "string" ||
      typeof evidence.contains !== "string" ||
      evidence.contains.trim().length === 0 ||
      !evidence.file.startsWith("server/src/") ||
      !evidence.file.endsWith(".test.ts")
    ) {
      fail(`Gate ${gate.id} has malformed deterministic evidence.`);
    }
    const absolute = repoFile(evidence.file);
    const source = readFileSync(absolute, "utf8");
    if (!source.includes(evidence.contains)) {
      fail(
        `Gate ${gate.id} expects missing test evidence ${JSON.stringify(evidence.contains)} in ${evidence.file}.`,
      );
    }
    deterministicSuites.add(evidence.file);
  }

  const behaviorEvals = gate.behaviorEvals ?? [];
  if (!Array.isArray(behaviorEvals)) fail(`Gate ${gate.id} behaviorEvals must be an array.`);
  if (behaviorRequired.has(gate.id) && behaviorEvals.length === 0) {
    fail(`Gate ${gate.id} requires model-behavior eval coverage.`);
  }
  for (const entry of behaviorEvals) {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof entry.file !== "string" ||
      !Array.isArray(entry.metrics) ||
      entry.metrics.length === 0
    ) {
      fail(`Gate ${gate.id} has malformed behavior-eval coverage.`);
    }
    const absolute = repoFile(entry.file);
    const source = readFileSync(absolute, "utf8");
    for (const metric of entry.metrics) {
      if (typeof metric !== "string" || metric.trim().length === 0) {
        fail(`Gate ${gate.id} has an empty behavior metric.`);
      }
      if (!source.includes(`metric: ${metric}`)) {
        fail(`Gate ${gate.id} expects missing metric ${metric} in ${entry.file}.`);
      }
      behaviorMetricCount += 1;
    }
  }
}

for (const id of expectedGates.keys()) {
  if (!seenIds.has(id)) fail(`Missing required security gate: ${id}`);
}

const seenDomains = new Set();
for (const domain of manifest.evalDomains) {
  if (
    !domain ||
    typeof domain !== "object" ||
    typeof domain.id !== "string" ||
    !expectedEvalDomains.has(domain.id) ||
    !Array.isArray(domain.gateIds) ||
    domain.gateIds.length === 0
  ) {
    fail("Malformed eval-domain coverage entry.");
  }
  if (seenDomains.has(domain.id)) fail(`Duplicate eval domain: ${domain.id}`);
  seenDomains.add(domain.id);
  for (const gateId of domain.gateIds) {
    if (!seenIds.has(gateId)) {
      fail(`Eval domain ${domain.id} references unknown security gate ${String(gateId)}.`);
    }
  }
}
for (const domain of expectedEvalDomains) {
  if (!seenDomains.has(domain)) fail(`Missing required eval domain: ${domain}`);
}

console.log(
  `[aw-v4-security] coverage valid: ${seenIds.size} gates, ${seenDomains.size} eval domains, ${deterministicSuites.size} deterministic suites, ${behaviorMetricCount} behavior metrics.`,
);
