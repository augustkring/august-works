# Blentera V10 current software reconciliation — 28 October 2026

This is a current-source closeout overlay for the 169-work-ID index in
`doc/operations/aw-v10-evidence/recovery-2026-10-22/requirement-reconciliation.json`.
It does not revise that file's item statuses or create a second acceptance
register. The Oct 22 index is historical: at creation it recorded 145
`not_reconciled`, 24 `in_progress`, and an open release qualification. It is not
a current completeness measure. The brief explicitly says the ID count is not
the contract; requirements, inherited registers, acceptance journeys, and
§§47/50/55/56/57 control.

I read the repository instructions, the Ponytail skill, the V10 catalogue and
binding execution/qualification/runtime sections used below, the Oct 22
recovery record, and the latest recovery-plan entries through 28 Oct. The brief
is too large for a responsible line-by-line reread within this bounded audit;
the source clause is linked for every disposition. This reconciliation is a
source/evidence review only. No tests were run and no test is marked PASS here.
Scoped results below remain only the results at their recorded source pins; a
newer or mixed source tree does not inherit them.

## Required software closure, in priority order

| Priority | IDs / binding source | Current concrete gap and next close condition |
|---|---|---|
| P0 — execution and effect safety | `V10-163`, `V10-168`; §57.3 RT-01–04; §55.2 | Production execution is not closed by local policy tests or an artifact boot. Complete the actual host command → observed policy application → workload start/stop path, required provider/model routing, and operation-scoped credentials through their existing owners. The 27 Oct ledger notes say host UUID/labels/image checks were added, but capability/probe/target qualification remains unresolved; broker transport and a real provider-pack/runtime journey also remain open. Finish actual executable-path denials, revocation/late-result fencing, Stop, and unknown-effect recovery before any affected profile is offered. Then gather target-host/provider proof separately from software evidence. Evidence: `doc/plans/2026-10-22-blentera-v10-recovery.md` entries “27 October, runtime admission…” and “27 October, retained runtime…”; brief §§57.2–57.3, 55.2. |
| P0 — complete paid-call accounting | `V10-163`, `V10-168`; §57.3 RT-03; §56.3 | Finish the full wire-path inventory and exact reservation/dispatch/settlement receipts for every model caller, including setup/maintenance, tool-internal calls, CLI/provider-local paths, retries and fallbacks. Parent budget admission must count unsettled/unknown liability once and retries must not duplicate effects. The 27 Oct notes say the wire-receipt guards and migration were added while original callbacks and qualification were still underway. Close with real dispatch-boundary regressions for final-budget contention, duplicate IDs, tariff/authority change, lost response after provider acceptance, crash recovery and Stop. Do not treat ledger-table unit tests as proof the real caller crosses that ledger. Evidence: same recovery-plan dated entries; brief §57.3 RT-03 and §55.2. |
| P0 — prevent unauthorized private output and resurrection | `V10-162`, `V10-168`, `V10-169`; §§56.2, 56.5–56.6; §55.2 | Temporal Source/output sealing is not complete: the recovery plan records the six-case Source setup/assertions still open and the earlier Context-only seal was rejected because it did not bind all actual Native inputs and effect writers. Implement and prove the seal at the real dispatch/tool/request/effect owners. Preserve complete original Source/erasure receipts through deletion and restore; the brief requires prohibited derivatives not to reappear. Finish actual workspace restore/reconstruction and phase-valid migrations against current writer/state/recovery combinations. Evidence: recovery-plan entries on temporal Source and canonical company purge (incl. 27 Oct updates); brief §§55.2, 56.5–56.6. |
| P1 — agent operation parity and required operating knowledge | `V10-121`–`130`, `V10-134`–`145`, `V10-168`; §§43.14–43.15, 57.2, 57.6 | The canonical descriptors and platform admission are partial substrate, not complete conformance. Recent notes record required Skill admission wired into heartbeat/material owners, and canonical operation descriptors added, but Gateway PostgreSQL regressions, authored/native coexistence, runtime/profile delivery, reachability and negative/adversarial/recovery matrices remain incomplete or queued. OpenClaw/Hermes managed delivery code is partial; installed-vendor/profile qualification and A2A equivalence are still open. Close the exact current operation/catalog/Skill pins across runtime, actual session topology and canonical owners; prove one ordinary authorized work journey and denied/stale/revoked/replay branches per claimed profile. No profile is eligible merely because the reserved Skill is present. Evidence: latest “27 October, runtime admission…” and “27 October, retained runtime…” notes; brief §§43.14–43.15, 57.2, 57.6. |
| P1 — durable work/recovery on actual paths | `V10-019`–`024`, `V10-111`, `V10-160`–`162`; §§43.8, 55.2, 56.3 | Company Import now has a durable ledger, fenced checkpoints and transaction-paired logical writes, but current plan still records incomplete original import/process-recovery and cross-company governed-positive coverage. Complete crash-after-effect, unknown storage/provider outcome, retry/reconciliation, cancel/Stop, access loss, restore and duplicate-key cases using original producers/consumers. Recovery must return the original receipt, not make a second effect. Apply the same assembled-path standard to workflow/chat accepted messages and finalization; helper-only tests do not close these IDs. Evidence: latest Oct 27/28 recovery-plan entries including import and recovery continuation; brief §55.2. |
| P1 — explicit company guest-mode contract | `V10-123`, `V10-124`, `V10-129`–`130`; §57.4 ORG-01; §55.2 | Preserve and qualify cross-company **read and contribute** under current represented-human rights, same logical identity/local presence, target policy and source-sharing rules. The brief explicitly says delegated scopes are currently rejected in bounded orchestration and calls for preserving explicit cross-company reading and contribution. **Autonomous guest writes remain conditional**: only offer them after guest-scoped effect, accounting, revocation and result-ownership receipts are implemented and qualified. Do not remove the guard to claim completion, infer guest rights from portfolio/organizational membership, or drop multi-organization functionality from the product. Qualification must state the supported guest-mode matrix and test late revocation, cache isolation, source provenance and no home-company/private-Memory disclosure. Evidence: §57.2 table, §57.4 ORG-01, §57.6 acceptance matrix. |
| P2 — federated findability and case/status contracts | `V10-034`–`038`, `V10-039`–`054`, `V10-060`–`065`; §§43.2–43.4, 43.9 | Universal Find UI has scoped evidence in the recovery record, but server adapters still need current qualification. Complete required adapters/permission filtering/partial-failure behavior and deterministic Cmd+K routing. Separately, do not conflate the recently added disabled Statuspage adapter with completion of incident publishing, in-app projection, subscriber notifications and failure/runbook paths. Current plan also describes a read-only public status adapter while provider/domain/notification qualification is intentionally absent. Support-case/help intake, human handoff and legal/trust evidence registry/negative stale-evidence behavior remain separate contracts; complete software seams and failure UX while leaving missing live suppliers/people as external qualification. Evidence: Oct 27/28 recovery-plan entries; brief §§43.2–43.4, 43.9, 55.2. |
| P2 — final current-head compatibility, copy and release evidence | `V10-164`–`169`, `V10-119`–`120`; §§47, 50, 55.2–55.6, 56.6 | Current notes explicitly leave the final unchanged-head workspace typecheck/test/build, complete browser/source-erasure acceptance, final Help/static reconciliation, exact migration phase matrix and integrated release dossier open. Complete paired EN/DA meanings and rendered critical states, actual first-value/recovery journeys, and named operator/Human/provider evidence on the exact candidate. Keep code checks, production-artifact checks, host/provider checks, operator drills, manual accessibility and representative human sessions as separate evidence classes. No stale/fixture-only success or compilation result is a release acceptance. Evidence: latest recovery-plan dated 27–28 Oct notes and brief §§50, 55–56. |

## Closeout sequence

1. Finish the owner-assigned P0 paths above at the original authorization,
   billing, source/effect and runtime owners. Keep unsupported runtime profiles
   and guest-act scopes closed while their receipts/proofs are incomplete.
2. On a frozen exact source and migration snapshot, qualify joined native
   operation/Platform Skill, temporal Source/erasure/restore, paid-path and
   durable-work journeys. Record the exact source pins and retain failures and
   incomplete runs distinctly.
3. Close remaining server-side Find, support/status/trust contracts and paired
   EN/DA critical flows; run the applicable current-head suite/build gates only
   after those owners stop changing the snapshot.
4. Reconcile every retained V10 ID against its actual clause, predecessor
   register and §55 journey. Update the existing index only with a concrete
   disposition, exact evidence pin/result, and remaining owner/action. Then
   assemble the §55.5 operator dossier and separate live Human/provider/host
   gates. Until then the honest state is **not ready**; partial source work and
   scoped PASS receipts do not establish release qualification.

## Evidence boundary

The October 22 JSON's `evidence` fields were intentionally sparse and the index
said it was not acceptance evidence. The recovery plan since records many newer
bounded results and many retained failures, but this review does not turn those
into present-day PASS claims. Specific source work attributed to current owners
may be underway; this document identifies closure conditions and leaves their
implementation and qualification to those owners. “No evidence cited here” is
not a finding that no source exists; “code added” is not a finding that the
required journey passed.
