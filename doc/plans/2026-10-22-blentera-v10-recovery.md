# Blentera V10 recovery checkpoint

The implementation target is the unchanged [V10 revision 4.0 brief](../reference/blentera-v10/Blentera_Master_Build_Brief_V10_FINAL_v4.0_2026-10-18.md). Its requirements remain binding. Embedded references do not authorize deployment, external messages, paid provider calls or merge.

## Recovered state

- Fork base: `81d3445b98b1cd80ff400ede6bd44ea71d88d735`.
- Worktree: `/workspace/blentera-v10`; branch: `codex/blentera-v10`.
- On 22 October the execution environment became available with an older V5 checkout. The earlier V10 worktree, provider checkout and test receipts were absent. Local refs, reflogs, unreachable objects, workspace backups and remote branch names did not recover that work.
- The original V5 checkout was preserved. The new worktree starts from the exact specified master. This recreates the starting point; it does not recover the missing implementation.
- The supplied brief was downloaded again and verified as SHA-256 `7f4387338e6c9ce82359801a92c802c55b9af5c92cd65d1b6271f8ae68970c22` (610172 bytes).
- All 39 supplied playbooks were downloaded again. Every file matches an existing retained V9 reference byte for byte. [The manifest](../reference/blentera-v10/recovered-attachments.json) records the exact hashes and repository paths. This verification does not claim a new full reading or requalification of their external assertions.
- Earlier conversation test results are historical, unavailable evidence. They do not establish a pass for this reconstructed branch.

## Working sequence

Follow brief §39: correctness/security, execution foundation, first value, daily work, service closure, remaining integration proof, optional intelligence, then release qualification. Preserve the existing V4–V9 domain owners. Reconcile the complete retained catalogue and gates before source completion.

Current bounded implementation work:

| Requirement | Existing owner | Change and acceptance | Current evidence |
|---|---|---|---|
| V10-146 / CE-07 | `packages/db/src/client.ts` | Remove ambiguous generic SQL replay. Preserve explicit domain reconciliation and the driver's connection recovery. | Old source produced three committed increments; fixed source preserves one and propagates uncertainty. Wire and real PostgreSQL checks pass; DB typecheck passes. |
| V10-147 / UP-01 logging | Original HTTP redaction and recursive secret-redaction owners | Adapt pinned upstream cloud/redirect redaction; include actually accepted fork gateway, readiness, relay and both OpenClaw bearer headers. | Initial and reviewer-discovered legacy sentinels fail against the missing controls. Final logging suites: 143 passed. Rejected-JWT audit repair additionally passes 39 focused tests and five real migrated PostgreSQL cases, including overlapping deletion; see the separate JWT checkpoint. |
| §50.3 / §55.2 account changes | `ui/src/pages/CompanyAccess.tsx` | Bind the original click to company, principal and exact session lifetime; check before dispatch and before/after waits. | Original page fails 10 regressions. Final page passes 29 tests; full UI typecheck and token gates pass after the ordinary SDK prerequisite build. |

Feedback exports now require their own configured processor, reject redirects and omit remote error bodies from diagnostics. Remote announcements require both explicit enablement and a selected HTTPS feed; no implicit upstream feed remains. [Processor controls](../operations/blentera-outbound-processors.md) and [software evidence](../operations/aw-v10-evidence/recovery-2026-10-22/processor-defaults-checkpoint.json) describe the scope. The feedback integration suites pass 46 tests; announcement feed and migrated PostgreSQL route tests pass 36. Telemetry, full egress inventory and actual processor/deployment qualification remain separate open work.

Only two subagents are used for these slices, both explicitly configured as `gpt-6.1-sol` with medium reasoning. No Astra agent is used. Root reviews their consequential changes. Installation and test concurrency remain bounded.

Node 24.21.0 was restored from the official archive after checking its published SHA-256 (`fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6`). pnpm 9.15.4 matches `packageManager`; dependency installation uses the frozen lockfile. No dependency, lockfile, migration or historical receipt change is implied by tool restoration.

Commit and push coherent checkpoints to the task branch after review. Do not leave the reconstructed source solely in the ephemeral filesystem. Before PR readiness, run the required whole-repository checks, selected upstream rehearsals, assembled journeys and independent review. No merge or deployment is authorized by this checkpoint.

The [software evidence checkpoint](../operations/aw-v10-evidence/recovery-2026-10-22/software-checkpoint.json) retains exact commands, source hashes, raw synthetic-fixture logs, failed runs and subsequent results. Overlapping runs are recorded separately. The first DB typecheck exposed a test-only generic mismatch, which was corrected; the final typecheck passes. Local wire-loss and PostgreSQL tests are distinguished from deployed network/provider qualification. A reviewer who did not author each slice inspected its changed path. The logging reviewer found the missing legacy bearer; the correction has its own reproduced failure, passing tests and reviewer closure.

[JWT audit evidence](../operations/aw-v10-evidence/recovery-2026-10-22/jwt-audit-checkpoint.json) retains failures and current scoped results. Its normal server typecheck remains pending the ordinary Runner prerequisite.

[Board CLI checkpoint](../operations/aw-v10-evidence/recovery-2026-10-22/board-cli-checkpoint.json) records the original-owner consent/key/audit vertical, rate limits, current-account UI and paired copy. Independent review found two additional concrete paths (physical key deletion and raw argv), both repaired and checked. Earlier and final focused suites remain distinct. Current typechecks, descriptor correction and zero-company/global audit coverage are still open.

Next current-source work is the remaining UP-02 closure and first-party Telemetry, followed by the remaining wave-A processor cutover and wave-B execution foundation. The earlier, missing V10 implementation is not silently treated as restored. Remaining catalogue entries and beta gates stay open pending actual source reconciliation and current evidence.

**Current disposition: not source complete, not system qualified, not beta accepted, not PR-ready.** This record documents recovery and work in progress; it is not a substitute for implementing the full brief.

Telemetry now requires affirmative enablement and an explicit validated receiver, with no built-in processor or followed redirect. Its old-source regression has nine failures; current full scoped suites pass 69, restored targeted admission passes 13, and shared typecheck passes. Independent privacy review is scoped to these controls; dynamic withdrawal and full egress/processor acceptance remain open. The descriptor correction passes 10 focused cases and adapter typecheck. Normal current UI typecheck passes. The ordinary Runner prerequisite build passes after actual release Rust compilation; no stub or bypass was used. See the separate telemetry, descriptor and Runner evidence checkpoints.

Independent presentation work now adds the shared ProductIdentity contract and derives existing feedback/support contacts from it. Browser titles, startup product name and PWA metadata use Blentera; eight supplied production icon files match their retained checksums, including a dedicated maskable asset. SECURITY.md points to the Blentera security route. Seventeen scoped tests, a separate overlapping three-case final PWA check, normal UI typecheck and token gates pass. This is a partial identity cutover; legal facts, actual communication ownership/public delivery, full brand/locale migration and public route qualification remain open. [Evidence](../operations/aw-v10-evidence/recovery-2026-10-22/product-identity-checkpoint.json).

The zero-company key-audit gap is repaired through existing auth_security_events, generated migration0502 and bounded native maintenance across profiles. Global creation/revocation evidence commits with the key change and survives account/key deletion for its finite retention. Additional held-key membership/admin revocation regressions fail against the previous order and pass after moving current-authority resolution after that lock. Final service/routes43, startup22, normal DB typecheck and normal full server typecheck pass; earlier test parse/type failures are retained. CLI typecheck is pending separately. [Global audit evidence](../operations/aw-v10-evidence/recovery-2026-10-22/global-board-audit-checkpoint.json). Next implementation is UP03 current task/project/privacy authority and all V8 derivatives; core source work is coordinated with the schema lease and current check holds. The complete brief remains required.

Normal full CLI typecheck also passes on the frozen global-audit/ProductIdentity source. All current scoped package typechecks are green; the mandatory whole-repository commands have not yet been completed. UP03 now starts as a new source wave with A owning DB/shared/canonical authorization, B owning original issue/project domain and API, and Root owning retained V8 provenance/derivatives and additional consumers. References survive source erasure as tombstones; permission checks cannot turn an absent source into company-wide access. New private controls remain unexposed until that complete graph and rollout admission are implemented and qualified.


UP-03 current-source checkpoint: migration 0503 and the original shared/schema/authorization owners are committed as `0a8b09b5a`. The full existing PostgreSQL authorization suite passed 78 cases; the original source genuinely failed the selected new administrative-DTO case, and exact restoration passed. Generation, numbering/safety checks and two shared contract cases passed. The receipts retain the initial 20-second fixture setup timeout and owned cleanup; the fixture now uses the existing canonical 90-second PostgreSQL setup constant. This is core software evidence, not private-work enablement.

The original analytical payload owner now narrows ordinary Task/run access before its no-analytical-roots return. The original Context manifest owner repeats source checks after its company/Memory and selected Task row waits, checks selected source versions, obtains the accountable Human from the persisted run, and enforces canonical Agent × Human company admission before returning. Independent review identified both the later selected-row wait and the all-open admission gap; real PostgreSQL failures reproduced each before correction. The final focused run passed 13 cases in two files, with three Memory regressions explicitly deselected. Those three Memory tests genuinely fail on the current Memory implementation and remain active in an unfiltered run. This work-in-progress checkpoint deliberately preserves them; it is not a green full suite or a PR-ready handoff. Raw failures, the fixture cleanup error and subsequent successful checks are retained in `up03-payload-context-progress.json`.

Next source closure remains mandatory: immutable actual Memory producer/source dependencies, retained private Task provenance on Agent-created projects, downstream Foundation/Learning/workflow/context, export/import and realtime boundaries, and a complete cross-channel two-organization revocation fixture. Private-work UI/admission remains unqualified. The next ordinary migration generation is coordinated as 0504 after both original project and Memory schemas are ready.


### UP03 Memory checkpoint (2026-10-22)

Retained actual source identities now narrow ordinary Memory recall, mutation/replay and maintenance copies. Actual PostgreSQL34/34 passed; a new meaningful list-limit regression first failed before the paging fix. See `up03-memory-source-checkpoint.json` and verbatim logs. This checkpoint does not qualify complete UP03 or V10. Concurrency lifetime, retained ordinary Context payloads, Learning cross-owner cycles, all other derivative surfaces, downstream typechecks and full release gates remain open.
