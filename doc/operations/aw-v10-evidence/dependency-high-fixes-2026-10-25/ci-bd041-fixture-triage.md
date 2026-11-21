# CI bd041 typecheck, build, and security-gate triage

Source CI logs: workflow jobs `121336363009` (Build), `121336363051` (Typecheck + Release Registry), `121336686540` (migration build), and `121336686341` (Security hard gates). Dependency installation succeeded in all inspected jobs. The production advisory gate also succeeded; no audit waiver or policy change is needed.

The three compile/build jobs reported the same server errors:

- `server/src/services/context/context-engine-integration.test.ts`: TS2322 at CI lines 401 and 1112 (issue-update actor typing and a nullable string passed where a string is required).
- `server/src/services/memory/memory-service.ts`: TS2304 for `currentHumanActor` at CI lines 2298–2343.

The current shared workspace has since changed those files: the Memory implementation now declares `currentHumanActor` in the revoke transaction, and the Context fixture includes updated source-task handling and explicit fallback strings. Those newer edits were made by their owning workstreams. Their current compile/test qualification is separate from this CI snapshot.

Security hard gates passed advisory rejection and security-eval coverage checks, then failed the deterministic security suite: 7 of 27 files failed, with 20 of 873 tests failing. Failures grouped as follows:

- `automation-artifact-service.test.ts`: “records hash-bound gates only through the system evaluator and activates a tested declarative artifact” — expected workflow run `succeeded`, got `failed`.
- `optimizer-evaluation.integration.test.ts`: five workflow-source authorization cases — “uses the native version workspace for actual generated-code replay, shadow, canary and active execution”; “uses generated contracts, reviewed runs, shadow observations, bound approval, canary and fallback”; “quarantines an active replacement when an authoritative reviewer corrects its output”; “quarantines a replacement when its pinned published workflow changes”; and “falls back when an activated candidate artifact is revoked”. Errors reported that the current Workflow reader was unavailable.
- `workflow-direct-agent.test.ts`: “erases delegated payloads, queues log erasure and blocks late or restored agent writes” — active company membership was unavailable.
- Memory-owned failures were handed to `memory_finish`: seven `memory-agent-tools.test.ts` cases, the `memory-maintenance.test.ts` postcondition receipt case, and two `memory-service.test.ts` source/deletion cases. The CI snapshot also showed the `currentHumanActor` ReferenceError, which is addressed by the newer Memory source edit.
- `context-engine-integration.test.ts`: Memory hydration failed with the same CI-snapshot `currentHumanActor` ReferenceError.

This note records CI evidence only. Current-source qualification of the three assigned fixture paths (automation artifact, optimizer, and direct agent) is tracked in the sibling `ci-bd041-fixture-triage/` directory after the locked source snapshot and targeted run.
