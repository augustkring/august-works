# August Works V4 customer pilot readiness

Status: PR 54 customer-pilot hardening gate.

This runbook is the final Golden Master gate before an external customer pilot.
It does not enable features automatically. Deployment and release remain
separate, and V4 execution capabilities stay governed by their existing
feature flags and authorization policies.

## Source of truth

The machine-readable readiness contract is:

`evals/aw-v4/pilot-readiness.json`

The executable validator is:

`scripts/check-aw-v4-pilot-readiness.mjs`

The security hard-gate source remains:

`evals/aw-v4/security-gates.json`

Migration authority remains the PR 53 reconciliation service and runbook.

## Repository gate

Run on the exact candidate commit:

```bash
pnpm check:aw-v4-pilot-readiness
pnpm test:aw-v4-security-evals
pnpm typecheck
pnpm test:run
pnpm evals:smoke
```

The dedicated AW V4 workflow also runs the static pilot-readiness contract after
typecheck/build, repository tests, and the security hard gates.

## Target-environment migration gate

Inspect first:

```bash
pnpm migrate:aw-v4:reconcile
```

Apply only safe, bounded repairs and fail unless the target environment reaches
the stop condition:

```bash
pnpm migrate:aw-v4:reconcile -- --apply --require-ready --batch-size 50
```

Increase the batch size only after observing the target environment. Pilot
evidence must record:

- `cutoverReady = true`
- `repairableCount = 0`
- `blockerCount = 0`
- a durable reference to the reconciliation report

Legacy fields and routes remain in place during the pilot. PR 54 does not
perform contract/removal.

## Rollout gate

The rollout stage for external customer use is `pilot`.

Every V4 high-impact feature in the readiness manifest remains explicitly
default-off in code. The same manifest records the required rollout metadata for
each governed V4 flag: owner, default, scope, dependencies, rollback behavior,
review date, and cleanup condition. The validator requires a one-to-one match
between this metadata and the governed flag set.

Enable only capabilities included in the selected customer allowlist or policy.

Two features require explicit additional approval evidence if enabled:

- `enableAutomationArtifactCodeExecutionV1`
- `enableWorkflowOptimizerPromotion`

For every pilot rollout record:

- name the rollback owner;
- verify the rollback path before exposure;
- keep deployment separate from feature release;
- preserve the exact candidate Git commit SHA;
- record the CI run and security-hard-gate run.

## Manual C3 checks

The evidence file must mark every check below `passed` and include a durable
evidence reference.

1. `migration_rehearsal` — target-environment reconciliation reaches the stop condition.
2. `tenant_security_review` — negative tenant/auth checks are reviewed for the candidate.
3. `keyboard_accessibility` — critical pilot flows can be completed without a pointer.
4. `drag_alternative` — workflow-builder operations that use drag have a usable alternative.
5. `approval_consequence_clarity` — destructive/high-impact approval UI states the concrete consequence.
6. `control_plane_slo_baseline` — observed availability/latency baseline is recorded for the pilot environment.
7. `backup_restore_rehearsal` — backup and restore are exercised for the pilot environment.
8. `feature_flag_rollout_and_rollback` — selected flags and rollback procedure are rehearsed.
9. `external_agent_scope_smoke` — external-agent scope and cancellation behavior are smoke-tested when enabled.
10. `customer_support_owner` — a named operator owns incident response and customer escalation during pilot.

## Pilot evidence file

Keep the evidence file outside source control when it contains deployment URLs
or customer-specific operational references.

It must include:

- `version: 1`;
- `environment`;
- full 40-character `commitSha`;
- ISO `recordedAt`;
- `automated.repositoryTestsPassed = true`;
- `automated.typecheckBuildPassed = true`;
- `automated.securityGatesPassed = true`;
- `automated.behaviorEvalsPassed = true`;
- `automated.ciRunUrl`;
- `automated.securityGateRunUrl`;
- `automated.behaviorEvalRunRef`;
- `migration.cutoverReady = true`;
- `migration.repairableCount = 0`;
- `migration.blockerCount = 0`;
- `migration.reportRef`;
- `rollout.stage = "pilot"`;
- `rollout.enabledFeatureFlags`;
- `rollout.rollbackOwner`;
- `rollout.rollbackVerified = true`;
- every required `manualChecks` entry with `status: "passed"` and non-empty `evidence`;
- `highImpactApprovals` for every enabled restricted pilot flag.

Validate the final evidence without printing its contents:

```bash
pnpm verify:aw-v4-pilot-readiness -- --evidence /secure/path/pilot-evidence.json
```

The validator fails closed on missing evidence, unknown governed flags,
incomplete migration state, unverified rollback, missing manual checks, or
unapproved high-impact features.

## Stop and rollback

Do not start or continue the pilot when any required gate is red.

Containment order:

1. disable the affected V4 feature flag or remove the company from its allowlist/policy;
2. stop new high-impact execution while preserving audit/history;
3. use the existing workflow/artifact/optimizer fallback or rollback path;
4. restore from backup only when state recovery requires it;
5. capture incident evidence before re-enabling the capability.

A code deploy alone never constitutes approval to re-enable a disabled feature.
