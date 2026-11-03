# Blentera V10 current software reconciliation — 28 October 2026

This is the current-source closeout report for the 169-work-ID index in
`doc/operations/aw-v10-evidence/recovery-2026-10-22/requirement-reconciliation.json`.
That existing register now carries per-item current dispositions, exact bound
clauses, scoped evidence references, pin comparisons, and remaining work. Its
Oct 22 statuses are retained as history. Neither the ID count nor a scoped
software receipt establishes completeness or release qualification. The brief explicitly says the ID count is not
the contract; requirements, inherited registers, acceptance journeys, and
§§47/50/55/56/57 control.

I read the repository instructions, the Ponytail skill, the relevant V10
catalogue and binding execution/qualification/runtime/notice clauses, the Oct
22 recovery record, and the latest recovery-plan entries through 28 Oct. This
is a bounded audit, not a claim that every line of the master brief or every
implementation path was reread. Scoped source findings and linked test attempts
are recorded separately; none establishes full current-head or release
qualification. A newer or mixed source tree does not inherit a prior test
result.

## Required software closure, in priority order

| Priority | IDs / binding source | Current concrete gap and next close condition |
|---|---|---|
| P0 — execution and effect safety | `V10-163`, `V10-168`; §57.3 RT-01–04; §55.2 | Production execution is not closed by local policy tests or an artifact boot. Complete the actual host command → observed policy application → workload start/stop path, required provider/model routing, and operation-scoped credentials through their existing owners. The 27 Oct ledger notes say host UUID/labels/image checks were added, but capability/probe/target qualification remains unresolved; broker transport and a real provider-pack/runtime journey also remain open. Finish actual executable-path denials, revocation/late-result fencing, Stop, and unknown-effect recovery before any affected profile is offered. Then gather target-host/provider proof separately from software evidence. Evidence: `doc/plans/2026-10-22-blentera-v10-recovery.md` entries “27 October, runtime admission…” and “27 October, retained runtime…”; brief §§57.2–57.3, 55.2. |
| P0 — complete paid-call accounting | `V10-163`, `V10-168`; §57.3 RT-03; §56.3 | Finish the full wire-path inventory and exact reservation/dispatch/settlement receipts for every model caller, including setup/maintenance, tool-internal calls, CLI/provider-local paths, retries and fallbacks. Parent budget admission must count unsettled/unknown liability once and retries must not duplicate effects. The 27 Oct notes say the wire-receipt guards and migration were added while original callbacks and qualification were still underway. Close with real dispatch-boundary regressions for final-budget contention, duplicate IDs, tariff/authority change, lost response after provider acceptance, crash recovery and Stop. Do not treat ledger-table unit tests as proof the real caller crosses that ledger. Evidence: same recovery-plan dated entries; brief §57.3 RT-03 and §55.2. |
| P0 — prevent unauthorized private output and resurrection | `V10-162`, `V10-168`, `V10-169`; §§56.2, 56.5–56.6; §55.2 | Temporal Source/output sealing is not complete: the recovery plan records the six-case Source setup/assertions still open and the earlier Context-only seal was rejected because it did not bind all actual Native inputs and effect writers. Implement and prove the seal at the real dispatch/tool/request/effect owners. Preserve complete original Source/erasure receipts through deletion and restore; the brief requires prohibited derivatives not to reappear. Finish actual workspace restore/reconstruction and phase-valid migrations against current writer/state/recovery combinations. Evidence: recovery-plan entries on temporal Source and canonical company purge (incl. 27 Oct updates); brief §§55.2, 56.5–56.6. |
| P1 — agent operation parity and required operating knowledge | `V10-121`–`130`, `V10-134`–`145`, `V10-168`; §§43.14–43.15, 57.2, 57.6 | The canonical descriptors and platform admission are partial substrate, not complete conformance. Recent notes record required Skill admission wired into heartbeat/material owners, and canonical operation descriptors added, but Gateway PostgreSQL regressions, authored/native coexistence, runtime/profile delivery, reachability and negative/adversarial/recovery matrices remain incomplete or queued. OpenClaw/Hermes managed delivery code is partial; installed-vendor/profile qualification and A2A equivalence are still open. Close the exact current operation/catalog/Skill pins across runtime, actual session topology and canonical owners; prove one ordinary authorized work journey and denied/stale/revoked/replay branches per claimed profile. No profile is eligible merely because the reserved Skill is present. Evidence: latest “27 October, runtime admission…” and “27 October, retained runtime…” notes; brief §§43.14–43.15, 57.2, 57.6. |
| P1 — durable work/recovery on actual paths | `V10-019`–`024`, `V10-111`, `V10-160`–`162`; §§43.8, 55.2, 56.3 | Company Import now has a durable ledger, fenced checkpoints and transaction-paired logical writes, but current plan still records incomplete original import/process-recovery and cross-company governed-positive coverage. Complete crash-after-effect, unknown storage/provider outcome, retry/reconciliation, cancel/Stop, access loss, restore and duplicate-key cases using original producers/consumers. Recovery must return the original receipt, not make a second effect. Apply the same assembled-path standard to workflow/chat accepted messages and finalization; helper-only tests do not close these IDs. Evidence: latest Oct 27/28 recovery-plan entries including import and recovery continuation; brief §55.2. |
| P1 — explicit company guest-mode contract | `V10-123`, `V10-124`, `V10-129`–`130`; §57.4 ORG-01; §55.2 | Preserve and qualify cross-company **read and contribute** under current represented-human rights, same logical identity/local presence, target policy and source-sharing rules. The brief explicitly says delegated scopes are currently rejected in bounded orchestration and calls for preserving explicit cross-company reading and contribution. **Autonomous guest writes remain conditional**: only offer them after guest-scoped effect, accounting, revocation and result-ownership receipts are implemented and qualified. Do not remove the guard to claim completion, infer guest rights from portfolio/organizational membership, or drop multi-organization functionality from the product. Qualification must state the supported guest-mode matrix and test late revocation, cache isolation, source provenance and no home-company/private-Memory disclosure. Evidence: §57.2 table, §57.4 ORG-01, §57.6 acceptance matrix. |
| P1 — model/provider dependency lifecycle and explicit migration | `V10-073`–`079`; §19 | Deployment-pinned qualification profiles can now carry owner-declared lifecycle, region/routing, data-use, supported modalities/tools/rate limits, retirement and replacement facts. Runtime rechecks lifecycle and never silently substitutes a profile. The existing Agent Authoring candidate path records exact profile/configuration hashes, runs its reserved conformance probes, and keeps Human publication separate. Its catalog now identifies an exact current agent profile, unresolved profile references and published workflow revisions that reference that agent; a synthetic DB integration passed 8/8 (attempt-10), and focused lifecycle tests passed 21/21 (attempt-5). Actual provider/deployment profile facts remain unpopulated and explicitly untracked. Full coverage of other consumers, durable customer-profile migration, model-task quality evaluation, rollout monitoring, rollback receipts, and a canonical Action Needed projection remain open. Do not infer provider dates or auto-fallback. Evidence: reconciliation register 073–079 and `doc/operations/aw-v10-evidence/model-lifecycle-2026-10-28/attempt-5/`, `attempt-8/`, `attempt-10/`.|
| P2 — canonical notice and customer changelog closure | `V10-055`–`060`; §§14, 43.9, 55.2 | The optional announcement feed remains a dismissible communication surface and cannot create mandatory/security authority. The mandatory projection now reads only current Trust material-change requirements and switches on the canonical exact mode: per-principal notice-read, per-principal reacceptance, company-wide current-owner/admin acknowledgment, or no action. It links the exact public body and requires that mode’s receipt; local hide is not completion. Trust routes recheck current Human/account generation/company membership and current reviewed/public exact-version state. Source-pinned Trust mode/API tests passed 21/21, notice/projection tests passed 33/33, migration safety passed, and UI typecheck exited 0; the OpenAPI suite passed 26/26 with the mounted session-only Human route. The earlier six-suite attempt remains 70/71 with one pre-fix failure and is retained as such. Other canonical owner domains and changelog lifecycle projections remain open; hosted Trust Center, procurement, policy, and accessibility qualification are not established. Evidence: reconciliation IDs 055–060, `doc/operations/aw-v10-evidence/trust-material-change-modes-r1-2026-10-28/`, and `doc/operations/aw-v10-evidence/mandatory-notices-2026-10-28/attempt-7/`, `attempt-8/`, `attempt-4/`, `attempt-5/`, and `attempt-6/`.
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
3. Close remaining server-side Find, support/status/trust and notice contracts,
   including current route and rendered notice verification, and paired EN/DA
   critical flows; run applicable current-head suite/build gates only after
   those owners stop changing the snapshot.
4. Resolve the open per-ID owner/path gaps in the existing index against each
   predecessor register and §55 journey. Attach current source pins and raw
   proof only after the final candidate snapshot exists. Then assemble the
   §55.5 operator dossier and separate live Human/provider/host gates. Until
   then the honest state is **not ready**; partial source work and scoped PASS
   receipts do not establish release qualification.

## Evidence boundary

The October 22 JSON's `evidence` fields were intentionally sparse and the index
said it was not acceptance evidence. The recovery plan since records many newer
bounded results and many retained failures. This review retains the earlier mandatory-notice 70/71 attempt as a failure. It records the later four-mode Trust/API 21/21, notice/projection 33/33, migration safety, UI typecheck, and Agent Runtime candidate integration 8/8 as separate bounded results. None establishes present-day full-suite or release PASS.
“No evidence cited here” is not a finding that no source exists; “code added”
is not a finding that the required journey passed.

## 29 October — bounded migration-phase and revocation source audit

This is a source/evidence audit for `V10-169` and `V10-159`, not a live-database
or release qualification. The binding migration requirements are MIG-01–07 in
the master brief, lines 8400–8412; the register's V10-169 asks for current
writer/state/recovery definitions and old/new combinations. The source sample
below covers the current tail of the 563-entry Drizzle journal and the material
families with existing migration-specific receipts. It does not claim that all
563 migrations or all upstream slices were assessed.

| Phase / clause | Current source and retained evidence | Finding and smallest meaningful closure |
|---|---|---|
| MIG-01 semantics; MIG-02 old/new compatibility | `packages/db/src/migrations/0558_better_auth_issuer_compatibility.sql` refuses duplicate `(provider_id, account_id)` rows before dropping issuer-based uniqueness; `packages/db/src/better-auth-account-issuer-migration.test.ts` covers historical rows, collision refusal, and new uniqueness. `doc/plans/2026-10-22-blentera-v10-recovery.md` entry 28 Oct records the scoped auth/DB result. | This is real semantic protection for the Better Auth key change, not proof of mixed deployed versions. Retained tests do not run old and new application readers/writers against the pre/post schema. Add an isolated migration integration case that exercises both declared versions across each permitted phase, or document and enforce a no-mixed-version deployment boundary. Do not infer absence of external consumers from repository search. |
| MIG-03 phase authority and recovery | `packages/db/src/migrate.ts`, `packages/db/src/client.ts`, `_journal.json`, and `check-migration-numbering.ts` identify ordered migration execution and pending-history checks. `0554`, `0555`, `0558`, `0561`, and `0562` have concrete schema/migration artifacts; receipts include `human-workflow-coverage-2026-10-28/official-0561-migration-receipt.md` and `support-improvement-bridge-2026-10-28/r1/migration-0562-generation-receipt.json`. | Generation, numbering, safety lint, and schema-snapshot drift are not a phase record. No reviewed per-migration record was found for preconditions, authoritative writer, allowed app versions, stop/continue criteria, recovery choice, irreversible point, or named operator. Smallest closure is a scoped phase record for each material migration (starting with 0554 and 0558), linked to the exact SQL and test receipt; do not manufacture a universal rollback policy. |
| MIG-04 bounded backfill and reconciliation | `0554_company_import_fenced_effects.sql` adds lease/checkpoint fields and runs one unbounded `UPDATE` over every `customer_operations` row where type is `company_import` and status is `running`, assigning attempt ID and an already-expired lease. `0555_company_membership_permission_initialization.sql` stamps every existing user membership with `clock_timestamp()`. Current import recovery in `server/src/services/company-import-jobs.ts` selects expired running rows in `IMPORT_RECOVERY_BATCH_LIMIT` batches with `skipLocked`, then changes them to `needs_reconciliation`; it does not replay an unknown effect. | The runtime has bounded recovery and fail-closed unknown-outcome handling, but that does not bound the 0554 migration backfill. The 0554 statement can lock/update the full qualifying population in one migration transaction; no count, batch checkpoint, lock/statement budget, or migration-specific population reconciliation receipt was found. Before claiming MIG-04, either establish/record a reviewed scale and lock budget for this atomic one-shot update or split/replace it with a bounded resumable migration procedure. Verify eligible-row counts and that all migrated attempts enter `needs_reconciliation` before any replay. For 0555, verify existing user memberships are stamped without granting new permissions; the SQL itself only adds the marker. |
| MIG-05 rollback vs roll-forward | `packages/db/src/migrate.ts` inspects and applies forward migrations; the reviewed tail includes constraint/index/trigger changes and the new tables/columns in 0561–0562. Source checks do not define reverse SQL. | No rollback/roll-forward/restore/isolate decision record was found for the sampled material changes. For each phase, identify the state in which old code remains valid, the point after which only roll-forward is allowed, and the recovery owner. At minimum rehearse a failed transaction/restart on an isolated DB and confirm migration history and schema remain consistent; this does not substitute for production recovery approval. |
| MIG-06 transition retirement | Current journal tail includes additive/new contracts (0554–0562); 0561 creates a new coverage table and nullable workflow-run reference, and 0562 creates support-case issue links. `quarantine.ts` invalidates restored sessions, verification rows, API keys, host credentials, runtime jobs/bindings and pauses agents before restore admission. | The source shows explicit fail-closed restore handling and new additive contracts, but no sampled migration record names remaining compatibility shims/consumers, observation horizon, cleanup owner, or retired data derivatives. Keep cleanup conditional on actual consumer cadence and retention; no fixed sunset is supported by the evidence reviewed. |
| MIG-07 authority; restore with unknown provenance | `packages/db/src/migrations/0511_native_run_input_source_binding.sql` and `0533_native_run_input_source_dispatch_receipts.sql` reject restoration of erased native inputs; `0550_native_manifest_run_owned_purge.sql` allows manifest removal only with same-transaction company erasure proof. `server/src/services/saas/quarantine.ts` runs migrations on an isolated restore target and keeps admission blocked while reconciling external/current erasure ledgers. | These are concrete safeguards, not a complete end-to-end restore drill. No current receipt was found proving a full restore with post-backup revocation/erasure evidence, unknown/missing provenance, and blocked customer reads/writes/jobs/outbound effects through operator release. Smallest meaningful check: use the existing isolated quarantine/backup path, restore a fixture with a post-snapshot tombstone plus one missing-provenance record, prove suppression/unknown remains fail-closed, and only then test explicit operator release. AI-generated plans/manifests must continue to enter through the existing scoped migration/restore authority; code generation is not approval. |

The minimal evidence set to close this scoped V10-169 sample is therefore: (1)
an explicit 0554 scale/lock decision and population reconciliation or bounded
backfill; (2) a real old/new-version compatibility case for each declared
coexistence window, or an enforced deployment exclusion; (3) phase-specific
recovery records and interrupted-migration restart proof; and (4) the isolated
restore test above. The existing official checks remain useful but answer
narrower questions: `packages/db/src/check-migration-numbering.ts` validates
journal/file numbering, `check-migration-safety.ts` is static policy lint,
`migration-snapshot-drift.test.ts` compares the current schema with the newest
snapshot, and generation receipts prove artifact creation. None alone proves
live upgrade, mixed-version behavior, or recovery.

### V10-159: company-deletion stop-path correction

The source gap identified in the read-only audit is now corrected in the
existing archive owner. `server/src/services/saas/offboarding.ts` still archives
the company at request time to fence admission immediately. When the `revoke`
worker later calls `companyService(db).archive(...)`,
`server/src/services/companies.ts` now runs the canonical
`applyArchiveCascadeInTx()` even if the company is already archived, then calls
the existing `finalizeArchive()` Stop path. Ordinary repeated archive calls
remain idempotent. The worker claims `revoke_finalizing` with its exact
`notBefore` lease; both success and error updates compare that claim token, and
stale calls that no longer own a due revoke phase no-op. This also prevents a
late same-stage worker from overwriting a newer worker's completion.

Retained bounded evidence is the full company-service PG file (22 passed),
including the archived-company cascade regression
(`/workspace/v10-preparation/v10-159-offboarding-cascade-current-r1-20261029-test.log`),
the managed Native Stop regression (1 passed)
(`/workspace/v10-preparation/v10-159-offboarding-native-current-r1-20261029-test.log`),
and the concurrent lease barrier covering both late completion and late error
(2 passed; `/workspace/v10-preparation/v10-159-offboarding-lease-barrier-r2-20261029-test.log`).
The deletion UI label regression passed 3 tests
(`/workspace/v10-preparation/v10-159-offboarding-ui-r1-20261029/test.log`).
Each PG receipt has a successful source snapshot and Oxc syntax check. The
company/offboarding source hashes in the full service, Native, and barrier
receipts match current production files; the UI receipt likewise matches the
current page and translation files. This establishes these focused source
behaviors only; it does not establish deployed-provider, credential, external
queue, backup, or operator revocation across a production environment.

This finding is separate from external qualification: it does not establish
whether every credential, provider grant, queue consumer, backup, or human
operator is revoked in a deployed environment. Those remain separately scoped
evidence, not additional source defects inferred from missing receipts.
