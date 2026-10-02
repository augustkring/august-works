# August Works V4 migration cutover

Status: migration/backfill reconciliation gate, with 2026-10-02 completion changes.

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

## Completion migrations 0304–0320

These migrations add workflow execution principals, immutable typed results,
connector receipts, deletion markers, Memory provenance, optimizer evaluations
and observations, explicit failure recovery, delegated trigger authority and
Direct Agent Call wait bindings. Migration 0319 adds database guards for erased
workflow-derived agent payloads. No legacy target column is removed.

Run `pnpm --filter @paperclipai/db check:migrations` before the upgrade. Use the
normal migration runner; do not edit a deployed migration or its journal.
Back up the target database and retain the company deletion ledger separately.
Apply migrations before starting the new server. Keep new rollout flags off
until target reconciliation and the applicable pilot checks pass.

### Existing delegated configurations

Migrated Routine and Pipeline workflow targets have no inferred execution
principal. An identified active company member with `workflows:run` must save
the workflow target configuration in the product. The server stores that actor
as the delegation source. It rechecks the actor when work executes. A queued
Pipeline automation uses its saved enqueue-time principal and target binding.
Do not fill these fields from a responsible-owner label, an anonymous local
board or an unrelated administrator. A missing or revoked delegate fails closed.

### Existing failure policies

The old `continueOnFailure: true` field no longer permits implicit continuation.
Publishing requires an explicit failure policy. An existing published revision
without that policy stops on failure. Review the graph and publish a new
revision with `fail_workflow`, a declared failure branch, human recovery, or
`continue_with_null` with explicit nullable downstream input schemas. Do not
rewrite old revisions or infer nullable contracts from a previous successful run.

### Restore after Memory erasure

Export the company deletion ledger through the Memory privacy API before a
backup or restore rehearsal. Retain only this content-free ledger in the
separate recovery location. After restoring a backup, import the retained
ledger before exposing the instance. Ledger import works with Memory disabled.
Reapply retention cleanup and allow durable log-erasure jobs to finish. Verify
that a forgotten record, its delegated results and its run logs remain hidden.

Log erasure retains empty local and remote `.erased` markers. Preserve these
markers when moving log storage. Do not remove them to recover an old log.
Remote storage checks fail closed while marker visibility is unavailable;
restore log availability by repairing storage access, not by skipping markers.
This covers application-owned database and log copies. Review external
provider retention and arbitrary workspace files through their own procedures.

### Rollback boundary

Pause new workflow targets and stop dispatch before rolling application code
back. Retain additive database fields, deletion markers and log tombstones.
An older server does not enforce the new privacy guards on reads, so do not
serve a restored database through old code until the erasure ledger has been
reapplied and target checks pass. Forward repair is preferable to dropping
privacy constraints or removing migration rows.

Local PostgreSQL tests exercise fresh migration, reconciliation, immutable
results, cancellation, late-write guards and restored Memory payloads. They do
not establish a production backup RPO/RTO. Record the actual target database
upgrade, restore, delegation rebinding and provider checks in the customer
pilot evidence file.

The logical JavaScript backup path now preserves CHECK constraints as well as
functions and triggers. Restored migration receipts alone do not prove that
an older backup retained every constraint; verify the actual target schema.
The unpublished 0319 privacy-guard and 0320 direct-call migrations support
safe replay against local development prototypes. The preserved cloud
development database was upgraded without reset and verified current with all
15 child-erasure guards installed.
