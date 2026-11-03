# Resource governance 0564 qualification

This portable evidence bundle records the published Resource0564 migration and the current follow-up source qualification. It does not include dependency trees, build output, private responsibility candidates, or unrelated source changes.

## Qualification results

- The immutable r6 qualification passed migration checks, database build, shared typecheck/tests, SQL preflight, Oxc syntax audit, and full server TypeScript check at its pinned source. The full server TypeScript check is historical: it was not rerun after the current follow-up fixes.
- PostgreSQL 17/17 and gateway 1 passed with 74 skipped are reused r14 results, identified by their original log hashes in `qualification-r6/reused-r14-evidence.json`.
- Fresh attempt9 used a new source snapshot into the qualified dependency mirror. Oxc checked 24 source files successfully; the Resource PostgreSQL integration suite passed 20/20; source hash guards passed. Logs and pins are in `qualification-attempt9/`.
- The r6 full-server TypeScript check pinned and passed with all five paths below included. The attempt9 Resource PostgreSQL 20/20 cases exercise the shared analytical admission gate; they do not integration-qualify each statistical provider entry point (business forecasting, causal claims, and process analysis) individually.
- Attempt9 includes three follow-up liveness/restore fixes: cleanup candidates are selected independently from queued workflow candidates with a bounded maximum of `2 * safeLimit`; Memory selects the oldest eligible per-company queue item so quota-blocked work cannot hide retention; settings repair preserves a separately validated Resource policy when another stored general setting is malformed.
- This evidence does not claim the overall software gate is green. Native all9 remains blocked, and the full server TypeScript check has not been repeated after attempt9.

## Exact Resource stage candidate

Stage these Resource-owned paths only:

- `packages/db/src/migrations/0564_broken_guardian.sql`
- `packages/db/src/migrations/meta/_journal.json`
- `packages/db/src/migrations/meta/0564_snapshot.json`
- delete `packages/db/src/migrations/meta/0558_snapshot.json`
- delete `packages/db/src/migrations/meta/0559_snapshot.json`
- `packages/db/src/schema/environment_leases.ts`
- `packages/db/src/schema/heartbeat_runs.ts`
- `packages/db/src/schema/native_run_finalizations.ts` (Resource cleanup index only; no Native runtime change)
- `packages/db/src/schema/workflows.ts`
- `packages/db/src/schema/memory_jobs.ts`
- `packages/shared/src/index.ts`
- `packages/shared/src/settings-visibility.ts` (hideable Resource setting)
- `packages/shared/src/resource-governance.ts`
- `packages/shared/src/resource-governance.test.ts`
- `packages/shared/src/types/instance.ts` (Resource policy type)
- `packages/shared/src/validators/instance.ts`
- `server/src/__tests__/resource-governance.integration.test.ts`
- `server/src/__tests__/tool-gateway.test.ts`
- `server/src/middleware/error-handler.ts`
- `server/src/routes/instance-settings.ts`
- `server/src/routes/tool-gateway.ts`
- `server/src/services/business-forecasting/service.ts` (analytical admission call)
- `server/src/services/causal-claims/service.ts` (analytical admission call)
- `server/src/services/execution-blocker.ts`
- `server/src/services/heartbeat.ts` (Resource-deferred admission handling only)
- `server/src/services/instance-settings.ts`
- `server/src/services/memory/memory-jobs.ts`
- `server/src/services/process-analysis.ts` (analytical admission call)
- `server/src/services/resource-governance.ts`
- `server/src/services/tool-gateway.ts`
- `server/src/services/workflows/workflow-executor.ts`

The corresponding current-file SHA256 pins are in `source-stage-candidate-hashes.json`; migration publication hashes from r6 are in `published-files-r6.json`. `source-tracked-resource.patch` contains tracked-file diffs against the recorded base commit, and `source-new/` contains the new Resource files and migration snapshot.

Do not stage `packages/db/src/schema/heartbeat_run_events.ts` or `packages/db/src/schema/index.ts`: both match the published r6 source pin and have no Resource diff. Do not stage `server/src/services/authorization.ts`, `server/src/services/memory/memory-privacy.ts`, `server/src/services/workflows/workflow-native-nodes.ts`, or other Native, auth, responsibility/offboarding, contacts, analytical privacy, or connector work. These are outside this qualification. No files have been staged or committed by this qualification work.

## Integrity

`SHA256SUMS` covers the evidence files except itself, the containing tarball, and its detached checksum sidecar. The tarball is `resource-governance-evidence.tar.gz`; it contains this directory's evidence files and excludes itself. The detached checksum is `resource-governance-evidence.tar.gz.sha256`.

## Separate cross-scope observation

CI reported a later C7 Native runtime-asset-erasure test failure on the attempt9 mirror at `server/src/__tests__/analytical-context-privacy.integration.test.ts:571`: after the final Memory tick, at least one erasure job was not `succeeded`. The C7 test is outside the Resource stage candidate and its diagnostic rerun is pending; this bundle does not attribute that failure to Resource or treat it as passed.
