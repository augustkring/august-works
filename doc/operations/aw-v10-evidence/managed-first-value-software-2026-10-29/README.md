# Managed starter and first-value software evidence — 2026-10-29

These are two separate pinned PostgreSQL runs against snapshots of the current software. They verify the versioned managed starter and its first-value activation flow in a controlled software fixture. The provider/model output and support recipient are fixture-controlled; this is not a live customer, hosted-provider, staffed-support, or GA qualification.

## Current-source cohorts

- `activation-manual-input-20261029-r9`: `server/src/__tests__/v7-agent-packages.integration.test.ts`, selected patterns `joins the versioned managed starter`, `atomically prepares one original canonical Task`, and `does not capture activation intent`. Result: 3 passed, 114 skipped, exit 0. This run follows the source fix that forwards the existing post-commit publication queue through `prepareActivationFirstTask`.
- `activation-owner-flows-20261029-r3`: same test file, the 13 selected activation/package/starter cases recorded in `*-runner.txt`. Result: 13 passed, 104 skipped, exit 0.

Each cohort has its own runner, snapshot, complete copied-source hash list, reconstructed source patch, syntax check, raw Vitest log, and exit receipts. The snapshots are distinct and should not be combined as if one run executed all 16 cases.

The versioned `BLENTERA_MANAGED_STARTER_PROFILE` is tied to a distinct registry package identity and the canonical specialist evaluation/completion contract. The integrated software case exercises actual package publication/installation, intended-purpose deployment, activation, source-bound first Task, native controlled draft execution, Human review, support intake, and opt-in support export. It asserts the meeting-note source reached the controlled model request and that the returned draft preserves the three reviewed boundaries: source fidelity, proposed versus agreed actions, and no invented owners or deadlines.

The test is software evidence only. It does not qualify an external provider, production deployment, billing operations, staffed support, incident response, or hosted customer journey. V10-118 therefore advances from disconnected subflows to an integrated controlled software path while its applicable real-provider/operator/customer evidence remains open. V10-150 now has a versioned starter profile and a controlled first-value receipt; this does not by itself establish release qualification or GA readiness.

- `activation-specialist-full-20261029-r1`: the full `v7-specialist-candidates.test.ts` unit file passed 8/8. This is a separate package-candidate contract receipt, not PostgreSQL integration or first-value qualification; its snapshot predates the later publication-queue argument in `activation-first-task-preparation.ts`, so it is retained only for the candidate-unit result.

Raw test logs and reconstruction patches are retained losslessly as `.gz` files; decompress them before replay or inspection.
