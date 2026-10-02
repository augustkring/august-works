# August Works V4 migration cutover

Status: PR 53 migration/backfill reconciliation gate.

This runbook implements the Golden Master expand/migrate/contract rule for the
Routine execution-target and Pipeline automation-target migrations. It does not
remove legacy columns or compatibility reads. Contract/removal is allowed only
after the reconciliation stop condition has been demonstrated in the target
environment and the regression suite remains green.

## Migration contract

```yaml
new_schema:
  routines:
    - execution_target_kind
    - execution_target_ref
  pipeline_automation_executions:
    - target_kind
    - target_ref
    - workflow_run_id

old_and_new_compatibility:
  routines: assignee_agent_id remains readable and agent-task writes remain dual-written
  pipelines: routine_id remains readable and routine-target writes remain compatible

backfill_strategy:
  routines: >
    Fill agent_task target fields only when assignee_agent_id resolves to an
    agent in the same company and both target fields are still null.
  pipelines: >
    Fill routine target fields only when routine_id resolves to a routine in
    the same company and both target fields are still null.

batch_size:
  default: 250
  maximum: 2000

rate_limit:
  model: operator-controlled sequential batches
  note: each batch uses bounded reads and compare-and-set updates

idempotency:
  routines: repaired rows no longer match the legacy-null predicate
  pipelines: repaired rows no longer match the legacy-null predicate

progress_metric:
  - routinesRepaired
  - pipelineExecutionsRepaired
  - repairableCount
  - blockerCount

reconciliation_query:
  implementation: server/src/services/aw-v4-migration-reconciliation.ts
  checks:
    - unsafe cross-company legacy Routine targets
    - active Routines without any execution target
    - agent-target/legacy-assignee mismatches
    - workflow targets carrying legacy assignees
    - invalid same-company agent/workflow target references
    - unsafe cross-company legacy Pipeline routine targets
    - invalid same-company Pipeline routine/workflow target references

stop_condition:
  repairableCount: 0
  blockerCount: 0
  cutoverReady: true

rollback_limit:
  safe_repairs: >
    Repairs are additive copies from existing legacy authority into the new
    target fields. Legacy fields are retained, so reads can continue through
    the compatibility path if rollout is paused.
  destructive_rollback: not required in PR 53

final_cutover:
  prerequisite: >
    Run reconciliation with --apply --require-ready in each target environment,
    retain the resulting report, and keep migration plus authorization
    regression suites green.

old_path_removal:
  included_in_pr53: false
  condition: >
    Separate contract PR after pilot evidence proves zero repairable rows and
    zero blockers across supported deployment paths.
```

## Operator commands

Inspect only:

```bash
pnpm migrate:aw-v4:reconcile
```

Apply safe repairs in bounded batches and fail unless the environment reaches
the cutover stop condition:

```bash
pnpm migrate:aw-v4:reconcile -- --apply --require-ready --batch-size 250
```

Use a smaller batch during a cautious production rehearsal:

```bash
pnpm migrate:aw-v4:reconcile -- --apply --require-ready --batch-size 50
```

## Failure semantics

The reconciler intentionally refuses to infer authority for ambiguous rows.
Cross-company references, missing active Routine targets, invalid target
references, and legacy/new-field mismatches remain blockers. Correct the
authoritative source row or product configuration, rerun reconciliation, and
only proceed when `cutoverReady` is true.

The command is safe to rerun. A completed safe repair does not match the repair
predicate again, and compare-and-set conditions prevent a concurrent modern
write from being overwritten by a stale reconciliation batch.
