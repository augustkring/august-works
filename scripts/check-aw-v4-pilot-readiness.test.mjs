import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const checker = path.join(repoRoot, "scripts", "check-aw-v4-pilot-readiness.mjs");

function currentCommitSha() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function run(args = []) {
  return spawnSync(process.execPath, [checker, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "test",
    },
    timeout: 2 * 60 * 1000,
  });
}

function completeEvidence(overrides = {}) {
  return {
    version: 1,
    environment: "pilot-fixture",
    commitSha: currentCommitSha(),
    recordedAt: "2026-10-01T12:00:00.000Z",
    automated: {
      repositoryTestsPassed: true,
      typecheckBuildPassed: true,
      securityGatesPassed: true,
      behaviorEvalsPassed: true,
      ciRunUrl: "https://github.com/augustkring/august-works/actions/runs/1",
      securityGateRunUrl: "https://github.com/augustkring/august-works/actions/runs/2",
      behaviorEvalRunRef: "artifact://behavior-evals",
    },
    migration: {
      cutoverReady: true,
      repairableCount: 0,
      blockerCount: 0,
      reportRef: "artifact://migration-report",
    },
    rollout: {
      stage: "pilot",
      enabledFeatureFlags: [
        "enableFoundationV1",
        "enableContextEngineV1",
        "enableWorkflowsV1",
      ],
      rollbackOwner: "pilot-operator",
      exposureControlRef: "artifact://pilot-exposure-policy",
      rollbackVerified: true,
    },
    highImpactApprovals: [],
    manualChecks: [
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
    ].map((id) => ({
      id,
      status: "passed",
      evidence: "artifact://" + id,
    })),
    ...overrides,
  };
}

function withEvidence(evidence, callback) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "aw-v4-pilot-evidence-"));
  const file = path.join(dir, "evidence.json");
  writeFileSync(file, JSON.stringify(evidence), "utf8");
  try {
    return callback(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("static pilot contract is valid", () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /static contract valid/);
});

test("require-evidence fails closed without an evidence file", () => {
  const result = run(["--require-evidence"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires --evidence/);
});

test("complete pilot evidence passes without echoing customer environment", () => {
  withEvidence(completeEvidence(), (file) => {
    const result = run(["--require-evidence", "--evidence", file]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /pilot evidence valid/);
    assert.doesNotMatch(result.stdout, /pilot-fixture/);
  });
});

test("automated run URLs must point to this repository", () => {
  const evidence = completeEvidence();
  evidence.automated = {
    ...evidence.automated,
    ciRunUrl: "https://example.invalid/actions/runs/1",
  };
  withEvidence(evidence, (file) => {
    const result = run(["--require-evidence", "--evidence", file]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /GitHub Actions run for augustkring\/august-works/);
  });
});

test("pilot rollout requires durable exposure-control evidence", () => {
  const evidence = completeEvidence();
  delete evidence.rollout.exposureControlRef;
  withEvidence(evidence, (file) => {
    const result = run(["--require-evidence", "--evidence", file]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /rollout\.exposureControlRef/);
  });
});

test("non-durable manual evidence reference fails closed", () => {
  const evidence = completeEvidence();
  evidence.manualChecks[0] = {
    ...evidence.manualChecks[0],
    evidence: "checked manually",
  };
  withEvidence(evidence, (file) => {
    const result = run(["--require-evidence", "--evidence", file]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /durable evidence reference/);
  });
});

test("non-ISO recordedAt fails closed", () => {
  const evidence = completeEvidence({
    recordedAt: "October 1, 2026 12:00 UTC",
  });
  withEvidence(evidence, (file) => {
    const result = run(["--require-evidence", "--evidence", file]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ISO-8601 timestamp with timezone/);
  });
});

test("high-impact feature fails without explicit approval", () => {
  const evidence = completeEvidence({
    rollout: {
      stage: "pilot",
      enabledFeatureFlags: [
        "enableFoundationV1",
        "enableWorkflowsV1",
        "enableAutomationArtifactsV1",
        "enableAutomationArtifactCodeExecutionV1",
      ],
      rollbackOwner: "pilot-operator",
      exposureControlRef: "artifact://pilot-exposure-policy",
      rollbackVerified: true,
    },
  });
  withEvidence(evidence, (file) => {
    const result = run(["--require-evidence", "--evidence", file]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /requires explicit approval/);
  });
});

test("high-impact feature passes with dependencies and explicit approval", () => {
  const evidence = completeEvidence({
    rollout: {
      stage: "pilot",
      enabledFeatureFlags: [
        "enableFoundationV1",
        "enableWorkflowsV1",
        "enableAutomationArtifactsV1",
        "enableAutomationArtifactCodeExecutionV1",
      ],
      rollbackOwner: "pilot-operator",
      exposureControlRef: "artifact://pilot-exposure-policy",
      rollbackVerified: true,
    },
    highImpactApprovals: [
      {
        flag: "enableAutomationArtifactCodeExecutionV1",
        approved: true,
        evidence: "artifact://security-approval/code-execution",
      },
    ],
  });
  withEvidence(evidence, (file) => {
    const result = run(["--require-evidence", "--evidence", file]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /pilot evidence valid/);
  });
});

test("migration blockers fail closed", () => {
  const evidence = completeEvidence({
    migration: {
      cutoverReady: false,
      repairableCount: 1,
      blockerCount: 1,
      reportRef: "artifact://migration-report",
    },
  });
  withEvidence(evidence, (file) => {
    const result = run(["--require-evidence", "--evidence", file]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not cutover-ready/);
  });
});

test("missing privacy hard-gate evidence fails closed", () => {
  const evidence = completeEvidence();
  evidence.manualChecks = evidence.manualChecks.filter(
    (check) => check.id !== "privacy_memory_deletion",
  );
  withEvidence(evidence, (file) => {
    const result = run(["--require-evidence", "--evidence", file]);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /Missing manual pilot check: privacy_memory_deletion/,
    );
  });
});

test("evidence for another commit fails closed", () => {
  const evidence = completeEvidence({
    commitSha: "b".repeat(40),
  });
  withEvidence(evidence, (file) => {
    const result = run(["--require-evidence", "--evidence", file]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /does not match repository HEAD/);
  });
});

test("enabled feature dependencies must be enabled in the same rollout", () => {
  const evidence = completeEvidence({
    rollout: {
      stage: "pilot",
      enabledFeatureFlags: ["enableWorkflowBuilderV1"],
      rollbackOwner: "pilot-operator",
      exposureControlRef: "artifact://pilot-exposure-policy",
      rollbackVerified: true,
    },
  });
  withEvidence(evidence, (file) => {
    const result = run(["--require-evidence", "--evidence", file]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /requires enabled dependency enableWorkflowsV1/);
  });
});
