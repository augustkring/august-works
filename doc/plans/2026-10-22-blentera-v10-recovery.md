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


### UP03 Context and private Memory checkpoint (2026-10-22)

Actual PostgreSQL49/49 passes across private payload, original Context and native maintenance suites after three meaningful regression captures (3 Context failures,2 private Memory scope failures,1 metadata-root failure). Joint ordinary migration0506 stores the original private Human and retained run Context IDs. Run history qualification remains explicitly incomplete/defaultfalse; no reader/producer gate is inferred. See `up03-context-memory-0506-checkpoint.json` for exact source pins, authentic failures and limits. Native SQL list/count/search provenance, intrinsic Agent ancestor narrowing, Learning source closure, portability/realtime, downstream typechecks and all remaining V10 catalogue/release gates remain open.


### UP03 Learning and intrinsic Agent checkpoint (2026-10-22)

Learning now checks every retained ordinary Memory root at its exact current version before the zero-analytical-root return, including all retained candidate cycles. Its corrected native fixtures first reproduced five authority failures; six final PostgreSQL cases pass, including a genuine cross-owner cycle denial and completed diamond. The separate receipt preserves the initial fixture errors. Commit `ccae12b01` retains this bounded work.

Shared and Human-reviewed Memory copies now keep the original private Agent restriction as well as the original Human. A genuine native regression failed before the guard. The next combined capture passed32 private payload and4 Context cases but failed the maintenance setup hook; a separate retry using the existing canonical setup timeout passed all14 maintenance cases. This is not a combined50-case pass. Normal DB typecheck passes with the native query/transaction surface separated from pool ownership. Commit `623d0518c` and `up03-private-memory-agent-checkpoint.json` retain the source and limits.

Further real regressions now reproduce native search/extractor disclosures, committed Memory resolver self-source corruption, and private live-event source-ID placeholders. Their corrections and current integration checks remain in progress. Complete SQL payload closure, temporal provenance, portability, native producer/reader qualification, every remaining V10 catalogue requirement and all release checks remain open.


### UP03 native delivery and producer checkpoint (2026-10-22)

Native live delivery now drops inaccessible Task/Project/run events entirely, retains every explicitly named source for intersection, and binds a socket to its actual persisted session. Genuine private-event and session-withdrawal regressions and current scoped PostgreSQL/socket checks are retained in `up03-private-live-checkpoint.json` and `up03-live-session-checkpoint.json`. Later deep-source waits, Agent/cloud identity lifetimes and safe UI invalidation remain open.

The native domain/search/portability checkpoint `ff605724b` retains current authority, bounded default SQL filtering and same-company source preflight in the original owners. Its eight selected domain cases and separate search/extraction cases pass; earlier failures and fixture corrections remain recorded. Private HTTP admission is still closed until the full vertical qualifies. Unsupported source release is withheld. Complete temporal payload closure, compound mutation outcomes and full portability qualification remain open.

The first whole-workspace typecheck passed the native Runner prerequisite checks and server compiler, then failed at four old UI fixtures. Those fixtures now explicitly represent company-scope runs; all92 related UI cases, UI typecheck and token gates pass. This does not turn the earlier whole-workspace failure into a pass. See `up03-ui-run-fixtures-checkpoint.json`.

Current native Memory capture reuses the existing job, candidate resolver, activity publication deferral and PostgreSQL transactions. Thirteen actual job cases pass, including replaced/expired claims and expiry inside a reached INSERT with no surviving Memory/evidence/audit/publication. The completed-producer source purpose is physically bound to the leased job's backend and top-level transaction; ordinary completed-run reads remain denied. Scoped proof and initial fixture failures are separate. Principal pinning through the final commit is the next bounded correction.

Additional source review remains required for immutable accepted native-result receipts and operation-id binding when semantic resolution attaches to an existing record instead of inserting a new record. Completed-run DTOs and model-authored metadata alone are not acceptance evidence. Complete Context history qualification and source tombstones are also still open. The exact169 numbered V10 requirements are retained in `requirement-reconciliation.json`; no requirement is marked complete by this checkpoint.


### UP03 maintenance publication checkpoint (2026-10-22)

A real PostgreSQL regression reproduced a candidate event escaping an outer maintenance rollback, including its rolled-back UUID and source IDs. Original maintenance now shares the existing deferred publication array with its native job transaction, and publishes after successful settlement and commit. Both new rollback/positive commit-visibility cases pass; the four-suite run passed50 and failed one existing history wall-clock budget, then that unchanged14-case suite passed alone. Normal server typecheck passes. Exact raw captures and11 unchanged source pins are in `up03-maintenance-publication-checkpoint.json`. This does not qualify crash-reliable publication, all private live entities, complete temporal payload closure or full V10.


### UP03 Context and model source tombstones (2026-10-23)

Two actual PostgreSQL regressions reproduced private source restrictions disappearing through Context→Memory and model-evidence→Observation source cascades. Ordinary generated migration0508 removes only those two source foreign keys and retains native same-company insertion checks using KEY SHARE; owning-object/company cascades remain. Eight current native cases pass, including both actual concurrent deletion orders and source ACL positives/negatives. Two earlier current captures failed solely at fixture company-deletion prerequisites; an environment-interrupted attempt has no verdict. All are retained separately in `up03-context-derived-tombstone-checkpoint.json`. No already-lost history is reconstructed. Immutable captured inputs, full source graph, live credential lifetime, full UP03 and V10 release checks remain open.


### UP03 native source delivery and next payload contract (2026-10-23)

Job API/history source checks passed four actual PostgreSQL cases, then five additional native producer/current-authority cases passed without production changes: nine total in the expanded fixture (`d7e8b8698`). Native source delivery and cognitive scope checks passed two original PostgreSQL/socket fixtures (`c056d16e3`). Source-checkpoint limits and earlier genuine failures remain retained.

The next mandatory payload graph work is mapped in [the native payload source contract](2026-10-23-blentera-v10-native-payload-source-contract.md). Actual dispatched input includes source bodies and staged attachments added after the persisted bootstrap, optional inventories, later tool reads and retained warm-session history. Exact captured body roots must be separated from current policy anchors. The existing seven-assertion Task/private Memory failure remains open; new snapshot fields alone or a dynamic traversal of every future Context would be insufficient. This is a source-only design, not implementation or UP03 completion.


### UP03 live credential waits (2026-10-23)

Actual native socket regressions reproduced three session withdrawals while source review waited, three stale Agent-key reads after a final credential UPDATE waited, and an availability failure for the same Cloud membership set returned in a different order. The original socket owner now repeats actual credential admission after source review, compares the effective actor, uses DB-clock session expiry, normalizes membership sets and builds key actors from the conditional UPDATE RETURNING row. All18 current native cases across three files and normal server typecheck pass with unchanged source pins. Exact initial fixture error, genuine failures and intermediate14-case pass remain separate in `up03-live-credential-checkpoint.json`. This is bounded credential-after-wait proof; atomic lifetime of all source policies, complete canonical Agent/cloud admission, the native Task/private Memory regression and full V10 remain open.


### UP03 native provider preparation waits (2026-10-23)

Two executor software boundary regressions reproduced provider preparation/admission continuing after source withdrawal during staging and launch-intent persistence. The original executor now repeats its existing canonical analytical payload guard after preparation waits and in the existing package admission callback after launch-intent persistence. Seven focused executor cases pass; three actual package-runtime contract cases verify refusal before fresh open, checkpoint recovery and warm attach. These are software tests with simulated authority withdrawal, not PostgreSQL source or external provider proof. An initial wrong-directory insertion selected no tests and supplies no qualification. Exact captures, pins and remaining limits are retained in `up03-native-source-after-prepare-checkpoint.json`. Ordinary copied private Memory, immutable complete input receipts, current full typechecks and all release gates remain open.


### UP03 canonical Foundation and Agent credential boundaries (2026-10-23)

Native Foundation transaction authority pins and exact same-company company-resource admission passed16 actual PostgreSQL cases, including the existing six Source cases (`cada576c1`). The source owner holds original canonical account, membership, grant, role, Agent/run and key facts through the actual transaction; scoped requests cannot become whole-company permission or widen during waits. Raw genuine regressions and fixture errors remain retained. This owner is not an escaped SQL/boolean permission or completed native payload graph.

Original HTTP/JWT/WS ingress now rejects malformed scoped keys, preserves documented null/absent standard keys, repeats actual active-key conditions at the last-used write, uses current RETURNING identity, retains the original scope ceiling through row waits, and rejects JWT at exact expiry. An actual61-case pre-final capture passed; the final64-case capture rendered PASS but its parent exit was lost in an environment reset, so retry is pending. Normal server typecheck passed before the last two small corrections; final native compiler was interrupted without a verdict. Token gates pass. See `up03-agent-scope-http-jwt-checkpoint.json` for exact sources, failures and limits. All files/commits survived the reset.

The next input-snapshot regression also proves a later private Task selection retroactively hides an earlier Task. Memory temporal fixture corrections are explicitly unqualified until the corrected actual capture completes. Frozen creation-time body roots versus current policy anchors, copied private Memory SQL filtering, full UP03 and all V10/release gates remain OPEN.


### UP03 reset retry and genuine temporal regressions (2026-10-23)

The unchanged final ingress fixture now passes64 cases with observed exit0, durable exit capture and11 unchanged source pins; the earlier rendered-only PASS remains distinguished. Two corrected native temporal cases genuinely fail after all positive/negative preconditions pass: later private Task selection hides an earlier shared Memory and an earlier derived Task, although their bodies did not change. Both native queries/cleanup and actual exit1 are captured. Earlier fixture mistakes and environment interruption remain separate; see `up03-native-payload-temporal-open.json`. The correction must replace read-time Task taint and future-Context traversal with actual creation-time body-source snapshots while preserving current source ACL/erasure. This remains an open implementation gate, alongside copied private Memory and all full V10/release checks.


### UP03 final scoped compiler checks (2026-10-23)

The current native server compiler and UI typecheck both close with actual exit0 and durable exit capture. The original normal server prerequisite chain passed before the final WS/JWT condition fixes; those unchanged prerequisite owners were retained. Token gates and the actual64-case ingress retry pass. This is scoped qualification of the current ingress/Foundation/native-executor changes; it does not qualify the new deliberately failing temporal tests, copied private Memory/source closure, the whole current workspace/full test/build or PR readiness.

### UP03 closed payload representation and DB integrity (2026-10-23)

The shared closed snapshot contract is implemented and pushed in `9596e88b2`. Generated0509 binds nullable original-owner snapshots to exact native payload bytes, owner/company and canonical digest; prior nonnull source sets cannot shrink, child Memory/asset changes invalidate their parent snapshot, and selected Context records cannot be rewritten. The focused current checkpoint passes16 tests across three files with actual/durable exit0 and14 unchanged pins. It follows genuine native regressions for protocol upgrade, wrong-owner/body seals, omitted Task text, retained-source removal, Memory evidence, attachment bytes/metadata and historical Context rewrites. See `up03-native-payload-source-binding-checkpoint.json` for exact scope, earlier failures and limits.

This layer supplies no source grant or completeness assertion. No producer stamps it yet; canonical writers must preserve old known snapshots or keep invalidated history unknown, and private DTO/export handling remains pending. The original7-assertion private Memory copy regression and two temporal regressions remain open, as do complete run input receipts, actual same-transaction source SQL and all V10/release checks.

The direct current server compiler now passes with actual/durable exit0 (`7467`) after correcting the native list projection to carry the actual new DB columns. Both preceding compiler failures are retained, including the intermediate omitted-row type attempt; no0/null proof values were fabricated. Current migration numbering/safety checks pass. Public proof DTO handling, producer stamping, all original privacy regressions and full release/workspace gates remain open.

### UP03 native proof fields in public responses (2026-10-23)

Actual PostgreSQL/HTTP regressions reproduced internal proof fields in Task, Project, Memory and Comment reads, including Memory export, mentioned Projects and heartbeat wake comments. The existing shared queued-Comment DTO exposed them too. Original known row response owners now use a small pure projection; internal DB rows remain intact and arbitrary nested user metadata is preserved. The current three-file checkpoint passes16 cases with actual/durable exit0 and nine unchanged source pins: four API cases covering11 reads, the three existing Memory lifecycle cases and nine shared queue/permission cases. Exact genuine failures, the initial SQL fixture typing error and the old Memory fixture corrections are retained in `up03-native-payload-public-response-checkpoint.json`.

The old Memory fixtures now create an actual auth account and an accountable native private producer run; no production source permission or expected status was weakened. Both before-nested and final current direct server compilation pass with actual/durable exit0; all nine final source pins remain unchanged. This checkpoint does not qualify every tool/portability/delivery surface, producer truth, complete run inputs or the original private Memory/temporal source failures. UP03, full workspace/release checks and V10 remain open.

### UP03 exact bootstrap Context reference handoff (2026-10-23)

The original wrapper now returns the exact Context manifest tuple with its trimmed markdown. The V5 owner returns actual fresh input Context references separately from the immutable inventory, which can still name an earlier Context. Original heartbeat persists `nativeBootstrapContextManifests` with the first native input under the locked run, and recovery preserves the old capture rather than filling missing history from later Contexts. NULL means unknown; an empty array covers this Context family only.

Seven wrapper/source-boundary cases plus an actual PostgreSQL repeat-preparation case pass8 with observed/durable exit0 and six unchanged pins; four unrelated V5 cases are explicitly filtered out. Current direct server compilation passes. Both actual data-loss regressions are retained in `up03-native-bootstrap-context-checkpoint.json`. This is a reference-handoff/data checkpoint, not a complete or globally immutable run receipt or source authority. Constructor persistence is traced/compiled, not yet first-transport/recovery-qualified. Full input digests, other input families, original privacy/temporal regressions and all V10/release gates remain open.


### 2026-10-23 — Original run input writer barrier (bounded checkpoint)

Generated migration0510 adds `nativeInputSourceProtocolVersion` to the original heartbeat run: historical/unspecified0, closed0/1, immutable after INSERT. Known original provider/draft/authoring probe markers cannot claim1. No constructor stamps1, and the integer never establishes complete input provenance, runtime mode or admission. Privileged replica/SQL restore requires independent admission; absence of a probe marker is not qualification.

Actual canonical PostgreSQL migration chain and five focused cases pass with observed/durable exit0 and all five source pins unchanged; generation exits0 and its47 pruned historical snapshots were restored. The first capture's4PASS/1existing-authoring-fixture failure is retained, with its exact test source. Current server compilation also exits0. Evidence: `up03-run-protocol-receipt.json` and raw logs in the recovery evidence directory. Existing public run column spreading still exposes the integer; no reader consumes it as authority. Complete run receipt, constructor stamps, mixed-writer/rollback and deployment qualification remain open.


### 2026-10-23 — Actual staged attachment source handoff (bounded checkpoint)

The original wake-file stager now returns separate internal `sourceCaptures` with the selected Task/comment/attachment/asset tuple, byte hash/size, explicit delivered/unsupported/failed/unbound disposition and then-selected nullable payload snapshot. Later asset mutation cannot rewrite that captured snapshot. An unavailable remote binding no longer claims a supported binding. Existing prompt projection carries no internal snapshots or capture paths.

Actual PostgreSQL regression first fails on lost source capture; current focused staging/history/omission cases pass4 with observed/durable exit0,2 unchanged source pins and current server compiler exit0. The initial wrong-config zero-test invocation is retained and excluded from qualification. Raw captures and exact RED test are retained; see `up03-native-attachment-source-checkpoint.json`. These internal return data are not yet a persisted dispatch receipt or permission/Ready proof. Full bootstrap, dynamic inputs, mutation copying and original copy/temporal regressions remain open.


### 2026-10-23 — Exact fresh conversation replay capture (bounded checkpoint)

Original `conversationReplay` retains the same selected Comment rows, full-microsecond epoch versions, exact sanitized/truncated JSON-line rendition hashes and nullable source snapshots alongside markdown. New focused native PostgreSQL cases reproduce2 actual failures before the collector change, then pass3 cases including existing reset behavior/three old calls. Selection still excludes deleted/prior-boundary/future/wake messages, chooses newest40 and renders chronological order. A captured rendition/snapshot remains unchanged after a later body edit; NULL history remains unknown.

Original heartbeat keeps partial replay captures separate from prompt/context wire data; workflow direct prompt and native review replacement exclude replay. Recovery preserves the original stored capture or historical absence. Actual observed/durable PG exit0, all5source pins unchanged and Root current server compiler exit0 are retained in `up03-conversation-replay-receipt.json`, `up03-conversation-replay-root-review.json` and raw logs. These3cases qualify the collector/reset behavior, not full provider dispatch, override/recovery execution or derivative admission.


### 2026-10-23 — Closed original run input source representation

The existing shared source contract now also represents one immutable bootstrap, actual dispatch captures and later inputs with their separate accountable Human identities. It reuses the same closed policy/input families and per-capture validation, limits the complete distinct population to256, bounds entry counts and encoded size, and never defaults missing/NULL history or adds a Ready/grant flag. A structurally valid base without dispatch is explicitly not execution qualification. Original payload snapshot behavior remains covered.

Current focused shared cases pass9 with observed/durable exit0 and unchanged source pins; current server compilation exits0 on the recorded five-source set. See `up03-native-run-input-source-contract-checkpoint.json`. Actual original-run DB integrity/erasure enforcement is separate ongoing work; no constructor stamps the protocol or writes this receipt, and actual source completeness, current source permission, transport and effect capture remain open.
