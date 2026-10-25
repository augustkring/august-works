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

### 24 October — saved search and suite repair checkpoint

The Help adapter now searches the checked docs-as-code projection through the
existing company search owner. It preserves configured article slugs, indexes
the full bounded article body, respects issue-only filters and checks generated
catalog freshness without rewriting it during typecheck. Focused search checks
passed (32 server and 22 UI tests); the integrated docs check passed. This is a
bounded Help adapter, not completion of the remaining federated Find domains or
the full Help information architecture.

The full workspace test attempt on `9dcf8cfe9` was interrupted during environment
reattachment after 21 failed suite summaries had been observed. Its retained
[inventory](../operations/aw-v10-evidence/workspace-suite-2026-10-24/checkpoint.json)
is a failure record, not a full-suite receipt. Subsequent fixes retain native
Routine identity at initial creation, preserve manual Routine identity when
linked to pipelines and repair genuine Human fixture records. The full external
chat file passes 142 tests; built-in agents pass 33 tests; AI connections pass
44 tests; the repair worktree server typecheck passes. The combined pipeline and
bundle run still has two pipeline failures, now at source-authority validation.
[Scoped receipts](../operations/aw-v10-evidence/suite-repairs-2026-10-24/checkpoint.json)
keep these passes and unresolved failures separate. Private Routine, private
Memory and temporal source regressions remain open. The V10 target remains
`in_progress`; PR-ready, release and production qualification are not established.

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


### 2026-10-23 — Original run input receipt integrity and erasure

Generated custom migration0511 binds the existing run profile's `nativeInputSourceReceipt` to the original company/run/Agent/Task identity, first accountable Human and PostgreSQL-canonical bootstrap bytes/digest. Only an insert-capable native writer may stamp the base together with its first execution input; old/missing input history cannot adopt a later base. The base stays immutable, dispatch/additional captures retain exact append-only prefixes and each new entry matches the then-current run Human, while acknowledged steering preserves earlier identities. Bounds/closed top-level sets are enforced; full finite input validation and current permissions still belong to native consumers.

Actual PostgreSQL8PASS, observed/durable exit0,4 unchanged source pins; normal custom generation and Root migration numbering/safety check exit0. The real first erasure-order failure, subsequent native-NULL fixture correction and real nonmarker source-erasure failure are retained with exact test/migration bytes. An early gate sees requested resurrection before existing erasure scrub; the late invocation of the same function validates final native scope. Original canonical source erasure may clear the whole profile and durably stamp the existing run-source deletion marker, so later source disappearance cannot resurrect it.

Evidence `up03-run-receipt-receipt.json` and raw captures. Fixtures bind structural native input JSON, not provider transport or live Human permission. No constructor/receipt producer enabled. The existing canonical erasure predicate's dynamic future-Context behavior, full input/delivery/effect pipeline, privileged restore and all broader release qualification remain open.


### 2026-10-23 — Freeze selected Context body closures at original owners

Generated migration0512 adds a nullable typed snapshot to the existing Context Memory root. Nonnull inserts must match the actual same-company Memory snapshot and original UTC millisecond version under SHARE; root identity/version/snapshot are immutable, exact no-op updates and owning-manifest deletion remain supported. Historical/analytical NULL/hash roots remain unknown, with no upgrade. All49 generator-pruned historical snapshots were restored. The first normal generation caught a prior0511 fixture's native postgres.json parameter type; only its type was corrected, and the exact failed compiler/test bytes are retained. Current generation exits0 and the old8receipt plus new5root cases pass13 with observed/durable exit0 and6unchanged pins.

Original ContextManifestService now captures selected Task snapshots under its existing version/share pin, freezes every expected Memory root including learned/derived roots, and writes immutable items after those actual snapshots are available. No caller metadata supplies proof. Known selected captures remain exact after source bodies change; NULL stays unknown. The first fixture used an invalid Memory source class and was corrected; the actual baseline then shows1genuine lost-snapshot failure plus1unknown-history positive. Current original manifest suite passes6 and current server compiler exits0.

Evidence: `up03-native-context-selected-snapshots-checkpoint.json` and `up03-context-memory-root-receipt.json`. Broader Context Engine attempt still has7failures (six missing-accountable-run fixtures and a workflow failure), preserved without a green claim; fixture diagnosis continues. Complete input collection/transport/effect copying/canonical graph and original copy/temporal regressions remain open.


### 2026-10-23 — Existing Context Engine accountable fixtures

The original seven-case suite now seeds actual accountable native runs and captures Memory dependencies through the original owner. Separate producer Tasks avoid falsely treating later retrieval Context as an earlier fixture input; both original same-run temporal regressions remain explicitly open. Workflow erasure still retains its actual Task/run source, and denied Foundation/private Memory assertions remain unchanged. No production code, grants, assertions or deadlines changed in this checkpoint.

Current exact source passes all7 cases alone in68.11s and direct server compilation exits0. During simultaneous compilation, the same suite passed6 and failed its3-second eligible Memory case with empty results; this load-sensitive failure is retained, not waived as a product guarantee. Earlier7PASS75.41s and initial compiler error in optional diagnostics are preserved separately. See `up03-context-engine-fixture-receipt.json` and raw logs. Complete input/dispatch/effect capture, canonical source graph, original privacy/temporal failures and full V10 release checks remain open.


### 2026-10-23 — Exact native plan/document source selection

Original document getter selects the actual same-document/company revision with its mutable document in one SQL snapshot. It reports a separate internal capture only when body/title/format/revision number match; otherwise the delivered legacy body remains source-unknown. Original TaskPlan getter retains its selected approved/latest revision snapshot and hashes its exact returned body after quarantine redaction. Both preserve existing public DTOs, including unknownNULL history. The continuation-summary getter reuses the original document owner instead of another SQL reader.

Original heartbeat retains separate task-plan/planning captures beside the first native execution input; recovery preserves the original capture or missing history. Ordinary Task-plan prompt capture is omitted when workflow/review replaces that prompt; planningContext remains a separate source family. These partial handoffs are not complete dispatch/permission/effect qualification.

Actual document baseline2RED, TaskPlan baseline2RED retained. Current document/summary12PASS and focused TaskPlan3PASS; final server compiler actual/durable0 and all6 pins unchanged. One fixture initially attempted to change a revision body without clearing its bound snapshot; the native DB guard correctly rejected it, and the exact failed test is retained. See `up03-native-document-source-checkpoint.json` and raw evidence. Full Task/ancestor/wake/instruction/tool/session input closure, canonical graph, original copy/temporal regressions and all V10 release gates remain open.


### 2026-10-23 — Actual Task/ancestor source selection and first native bootstrap

The existing heartbeat Task SQL helper is now directly testable with its original Db argument. It captures the same selected Task snapshot and full PostgreSQL microsecond version, strips internal metadata from its returned execution DTO, and updates the capture after actual checkout reselects. Original ancestor owner has a native-only callback for the first6 rendered ancestors; default route DTOs and queries remain unchanged. Internal captures retain selected scalar rendition hashes and nullable frozen body closures; later body mutations cannot replace them. Native first-input persistence retains Task and ancestor captures. Review/workflow replacement excludes ordinary ancestor Markdown but still retains the original Task source used by structured native title.

Actual baseline3genuineRED, current3PASS83.45s with4unchanged pins. A separate actual native bootstrap case passes1 in88.24s: first-input/profile captures exist before dispatch; actual Task title and plan revision then change while the stored profile/input remains exactly equal; original cancellation stops before any provider factory call.305 other cases are filtered, not claimed. Final direct server compiler exits0 with4unchanged pins. Raw logs, compressed exact source snapshots and timing qualifications are retained in `up03-native-task-bootstrap-checkpoint.json`.

This is selected-source/first-commit evidence, not actual provider transport, complete source permission or effect copying. HistoricalNULL remains unknown; no protocol writer/complete receipt enabled. Remaining input families, canonical graph, original private Memory/temporal failures and full V10/release gates remain open. Public Run response projection still needs to exclude the internal profile before these metadata may be considered server-only at every HTTP boundary.


### 2026-10-23 — Keep original Run source metadata server-side

Original agents route now shallow-projects its four full Run responses (wakeup, invoke, detail, cancel), omitting the internal runtime profile and native input protocol integer. Nested user result metadata with identical field names and stored original profiles remain intact. Internal getRun/decorate/read types and SQL columns are unchanged; list/live/activity/Skill DTOs already explicitly omit both fields, correcting the earlier full-row-list assumption.

Genuine exposure assertions first fail. Current actual PG detail plus three mock-backed HTTP mutations pass4 in94.85s with3unchanged pins; current server compiler actual/durable0. Initial first-case cold module transformation repeatedly exceeded the existing30s HTTP case limit; the exact source/logs are retained, and transformation warmup now occurs under the standard bounded beforeAll fixture budget without changing case deadlines/assertions/production guards. See `up03-native-run-public-projection-checkpoint.json`. Full91-case two-file suite is running separately, not yet claimed. This DTO checkpoint does not close the original private Memory/temporal source regressions or broader V10 release gates.


### 2026-10-23 — Full affected Run response suites

The complete two affected response files now pass all91 cases in232.25s with captured command exit0 and3unchanged source pins, including all86 existing/new mocked route cases and5 native PostgreSQL response cases. Full verdict/cleanup and process closure are observed; the original agent tool-session handle became unavailable after an agent model-capacity error, so no direct Root tool-closure result is invented. This closes the broader fixture-startup regression check for the projection change; it does not qualify full workspace/V10 or the still-open source graph. Raw `up03-run-public-dto-full.log` and updated `up03-native-run-public-projection-checkpoint.json` retained.


### 2026-10-23 — Initial customer product identity at entry pages

Login and activation headers, the managed-runtime label and billing copy now use Blentera. Both English/Danish login/create account title values are aligned while preserving all locale keys, styles/tokens and auth/billing behavior. Root independently reviewed the six-file diff and verified that only the expected three authFlow values per locale changed. Existing UI token gates pass0 across1423files. Low-cost gpt-6-luna assisted this bounded edit; no additional agent was spawned by it.

Evidence `brand-entry-copy-checkpoint.json` and raw token log. This is a partial§6 identity migration, not product-wide brand/locale/visual/a11y qualification. Feedback-sharing text remains tied to its actual upstream data behavior for separate migration; attribution, namespaces and compatibility are preserved. No new tests were added for the reversible text change. Full V10/release gates remain open.


### 2026-10-23 — Preserve selected inline wake comment renditions

Original wake payload owner retains each selected comment’s PostgreSQL microsecond version and nullable frozen snapshot in its operation-local map. A native-only callback hashes the final returned body/presentation/metadata after quarantine, body budgeting and secret redaction; selected deleted/foreign/missing rows cannot become captures. Public wake DTOs remain unchanged. First native input persistence retains this partial comment collection and recovery preserves its original history. The original conversation capture type is reused under the broader NativeCommentSourceCapture name.

Corrected baseline2 genuine failures retained separately from the initial invalid fixture. Current complete Comment suite8PASS56.88s; actual first bootstrap plus both existing cancellation cases3PASS70.39s; server compiler exit0 and all recorded source pins match. Bootstrap observes the stored Task/plan/comment sources before provider creation, then actual source edits leave the entire original profile/input unchanged; provider factory remains uncalled. See `up03-native-inline-comment-source-checkpoint.json` and raw logs. Single wake fallback and other input families, complete receipt/current permissions/transport/effect qualification, original Memory copy/temporal failures and full V10/release gates remain open.


### 2026-10-23 — Reuse existing product identity on entry pages

The same six-file entry-page change now reads the existing shared PRODUCT_IDENTITY instead of hardcoded Blentera labels. English/Danish auth titles interpolate productName; Root verifies identical rendered copy, all locale keys and unrelated values preserved. Billing explicitly preserves the space after productName. No new identity manifest/configuration introduced. Normal UI typecheck and all token gates exit0 on the final source. See `brand-entry-identity-reuse-checkpoint.json`. This supersedes the initial literal copy source pins, not full brand/locale/a11y or outbound-owner qualification.


### 2026-10-23 — Preserve separate wake request sources and redact continuation consumers

The original single-comment read now keeps its own selected microsecond version and nullable snapshot outside its unchanged context DTO. Separate request/context rendition hashes are retained with the first native input; a later batch read of the same UUID cannot replace this older selection. Original quarantine and secret redaction happen before query/completion consumers. A real registered-secret fixture then exposed a second path through continuation messages into the native completion contract; the original continuation owner now applies the existing secret registry after authority validation for every caller, including recovery/safe replacement.

Actual missing-source baseline1FAIL retained. Initial secret fixture1FAIL/1PASS; first fix still1FAIL/2PASS because the full native input contained the fixture secret through continuation. Both exact sources/raw failures retained. Final isolated native bootstrap plus original cancellation cases4PASS72.12s, both complete original continuation suites48PASS58.08s, and server compiler actual/durable0 with matching recorded source pins. The full input assertion excludes the registered fixture secret, real source edits preserve the entire first profile/input, and provider factories remain uncalled. An intervening concurrent PG initialization exceeded the original20-second hook and skipped307 tests; exact unchanged source passed alone, no deadline increase.

See `up03-native-single-wake-secret-checkpoint.json`. Partial source handoff only: remaining input families, complete receipts/current source permission/provider transport/effects, original Memory copy/temporal failures and all broad V10/release gates remain open.


### 2026-10-23 — Admit SaaS feedback locally and reuse its UI policy

Explicit SaaS settings admission now atomically merges the existing irreversible local-feedback policy before returning an existing/new/conflicted singleton. Old sharing preferences, a configured receiver and a disabled feedback feature cannot enable exports; profile rollback preserves the latch. Local/legacy never-admitted operator compatibility remains separate. The original first-party feedback feature is not force-enabled.

Existing general/V9 policy queries now serve all three vote/note surfaces. Loading/error policy remains local; pending legacy prompts save locally and clear, and later notes cannot reuse sharing true. The actual duplicate compact thread component is removed in favor of its existing shared owner. General settings omit inactive legacy export controls, instead of simply renaming their recipient. The processor operations document explains the deployment boundary.

Actual PostgreSQL focused admission1PASS129.83s; final four affected DOM suites120PASS93.64s; server compiler, final UI typecheck and UI token gates exit0. Root verifies final source pins. Genuine pre-fix settings exposure, initial React/query fixture timing failures and the broader thread mock missing-export failure remain in raw evidence; both old mocks now expose the shared policy hook, with original Markdown/error assertions preserved. See `saas-feedback-local-policy-checkpoint.json`. Low-cost gpt-6-luna assisted bounded backend/UI work; Root reviewed and completed verification. No external receiver was contacted. Full outbound/deployment/legal/a11y and V10/source-graph release qualification remain open.


### 2026-10-23 — Share-title and optimizer product identity

Two remaining actual software labels now reuse the existing PRODUCT_IDENTITY: standalone browser sharing fallback and optimizer’s incomplete-correction explanation. No upstream asset is relabeled: unused PaperclipLockup contains a literal upstream wordmark and remains unchanged with its truthful provenance title. Both modified source pins match before/final captures; token gate and UI compiler have durable0 and process closure. An attempted agent interruption occurred at completion, so no separate direct tool-closure result is invented. See `brand-copy-shared-identity-checkpoint.json`. No tests added for scalar copy; full brand/visual/V10 qualification remains open.


### 2026-10-23 — Preserve actual continuation comment selections

Original continuation owner selects the PostgreSQL microsecond comment version beside each existing full row/snapshot, then reports separate captures of the final secret/quarantine-redacted message rendition. Deleted bodies are omitted. Default envelope DTO remains unchanged. Initial native input persistence retains these captures separately from independently selected wake/replay versions; existing recovery preserves the original input/captures. No later query reconstructs selection history.

Actual baseline2FAIL71.18s; final real bootstrap cases2PASS93.63s, complete original continuation suites48PASS53.04s, and server compiler actual/durable0, all recorded source pins match. The fixtures include a deleted historical comment and actual registered secret; both remain absent from full native input. Real source edits leave the entire original profile/input equal, and provider factory stays uncalled. Read-only gpt-6-luna review found no concrete scoped defect. See `up03-native-continuation-comment-checkpoint.json`.

Partial source handoff only: interactions/prior results and other input families, complete receipt/current permissions/transport/effects and original private Memory/temporal/full V10 gates remain open. The next independent audit identifies registered-secret exposure through native answered-question envelopes; that separate path is not claimed fixed here.


### 2026-10-23 — Shared identity in English/Danish experience copy

The existing i18next initializer now supplies PRODUCT_IDENTITY.productName through its native defaultVariables mechanism. Eleven values per EN/DA experience catalogue use it for feedback, onboarding, provider-authority boundaries, native runtime/calculations, recovery and delivery explanations. Compatibility keys remain unchanged. The former Danish-only branded baseline label now has matching English interpolation while preserving its calculation meaning. Root verifies all keys and unrelated values, with exactly the expected eleven substitutions per locale; no other locale file uses this placeholder.

Existing locale suite8PASS1.59s includes real default interpolation for every changed key in both languages, no unresolved productName placeholder and French-to-English fallback. UI typecheck and token gates exit0; final source pins match. See `brand-experience-shared-identity-checkpoint.json`. No legal/operator identity inferred; full brand/locale/visual and V10 release qualification remain open.


### 2026-10-23 — Render shared identity during app error recovery

The existing provider-independent error surface selects raw locale JSON, so the new catalogue productName placeholder was displayed literally. Its original owner now replaces only that known app-title placeholder using PRODUCT_IDENTITY, preserving recovery when localization fails. Existing auth/error fixtures expect Blentera; the permission fixture uses native i18next rather than a manual translator that dropped default variables. Raw catalogue import audit found no other actual consumer outside initialization.

Four existing UI files initially38PASS/3FAIL on actual error headings; after the owner fix41PASS22.87s. Final UI typecheck and token gates exit0 with directly observed process closure. Root reviewed final source; bounded gpt-6-luna assistance. See `brand-ui-recovery-identity-checkpoint.json` and retained raw failure/source. Full customer brand/locale/visual and V10 release gates remain open.


### 2026-10-23 — Remove registered secrets from authoritative question answers

Original native interaction materialization now applies the existing issue-bound registry after all original authority/canonical/missing checks and before input construction. This covers answer JSON, its formatted summary and the existing legacy question projection, while keeping stored resolution proof unchanged. Actual bootstrap baseline1FAIL/1PASS64.62s retained; first fixed attempt exceeded the original20s setup and ran no behavioral assertions. Prestarting a dedicated fully migrated local PostgreSQL via the original helper and supported external-URL test branch gives2PASS57.62s with unchanged assertions/hook. Original bridge suite6PASS46.79s, final combined server compiler actual/durable0, final pins match. Dedicated database cleanup completed after the test. See `up03-native-answer-secret-checkpoint.json`. Complete receipts/current permissions/transport/effects and private Memory/temporal/V10 gates remain open.


### 2026-10-23 — Retain feedback admission during concurrent general-settings updates

Actual local-profile feedback flag enablement can commit its irreversible policy while updateGeneral still holds a stale read. The original full-JSON replacement then erases that latch. The new regression queues two real PostgreSQL row-lock waiters and releases feature enablement first; unchanged source fails with policy undefined. The original general-settings owner now mirrors updateExperimental: transact, lock and reread, then derive and write the existing normalization/operator/internal-state merge.

Corrected baseline1FAIL58.07s; fixed actual PG case1PASS113.74s; existing settings units22PASS17.71s; final combined server compiler actual/durable0 and all pins match. Initial direct-blocker fixture error and pnpm invocation that aborted before tests remain separately recorded. Only the existing operator-defaults DB stub gains transaction/for support; no assertions or existing deadlines weakened. Root reviewed and verified; bounded gpt-6-luna assisted. See `feedback-policy-concurrency-checkpoint.json`. Full outbound/deployment/restore and V10 release gates remain open.


### 2026-10-23 — Shared identity in adapter setup and access/configuration explanations

Actual software labels in six adapter components, onboarding preview, authenticated no-membership view, revision restore fallback and shared configuration help now reuse PRODUCT_IDENTITY. The OpenClaw example reads the existing appOrigin directly; it is not a derived hostname, runtime trust/default setting or live qualification. Provider names, protocol/config identifiers, actual runtime key-file path and upstream provenance remain intact. Only two directly matching existing display assertions change.

Existing Codex/Hermes suites6PASS28.91s; final UI typecheck and token gates actual/durable0 with all12 source pins matching. No new scalar-copy tests. Root inspected and verified, bounded gpt-6-luna assisted adapter work. See `adapter-access-product-copy-checkpoint.json`. Canonical Runner display/permission owners and complete brand inventory/CI/customer journeys remain open; full V10 gates remain open.


### 2026-10-23 — Freeze actual selected interaction response renditions

The original interaction-list SELECT conditionally captures the PostgreSQL microsecond version with the same row; the internal alias is removed before hydration/public return. The native bridge retains only authoritative responses after all existing resolver/canonical/governed/missing/self-approval checks and secret redaction, using existing nativeSha256 over each final response. The external chain buffers inside its attempt and emits only after transaction success. First-input persistence retains nativeBootstrapInteractionSources; recovery preserves old/missing captures.

Actual native bootstrap2PASS63.37s, complete original bridge6PASS129.15s (both denied callbacks remain empty), and coherent external-chain1PASS47.74s with two real blocked/serializing transactions. External collector is empty before commit, then exactly matches old selected versions/redacted-response hashes; the later coherent rewrite denies without adding captures. Final server compiler actual/durable0, all7 pins match. Initial external pass did not qualify its misplaced denied-retry callback: compiler exposed the test-scope mistake, Root corrected it. Corrected first rerun exceeded original30s database setup and skipped all142; final exact source uses original external-URL branch after prestarting/migrating dedicated local PG. Existing assertions/deadlines stay unchanged; failed source/logs retained. No forced no-wait retry claim.

Read-only gpt-6-luna reviewed production and assisted bounded existing test extension; Root reviewed/corrected and verified actual exits. See `up03-native-interaction-source-checkpoint.json`. Complete bootstrap/dispatch/history/tool receipts, permission/effect closure, original private Memory/temporal regressions and all broad V10 gates remain open.


### 2026-10-23 — Freeze actual authored runtime sources

Original retained runtime owner now emits actual inner-resolver authored definition, Foundation and Playbook versions/hashes, plus the exact retained Memory Context refs, only after successful transaction. Heartbeat saves them with the first immutable native input. Existing runtime snapshot already holds instruction/Skill bundle digests; no duplicate descriptor or protocol activation.

Initial combined case1PASS60.26s. Broader procedure suite exposed five existing helper runs not actually bound to their supplied Task; original Context guard rejected before capture. Root corrected fixture Task/Human/native run binding through initializeRunIdentity without weakening authority or assertions. Final complete procedure suite14PASS93.11s, nonauthored actual native bootstrap/recovery2PASS69.88s, final server compiler actual0, all four pins match. Failed source/log retained. Combined authored builder coverage is distinct from nonauthored heartbeat persistence; no authored heartbeat end-to-end claim. See `up03-native-authored-source-checkpoint.json`. Full receipt/effect/current-policy, private Memory/temporal and broad V10 gates remain open.


### 2026-10-23 — Shared identity in canonical Runner selection and permission explanations

Original adapter display registry and browser-safe Runner permission catalogue now reuse PRODUCT_IDENTITY for the customer product name. Actual identifiers, mode values, provider names and enforcement remain intact. Existing isolation/provider profile wording is retained, not new physical-host qualification. Existing2 suites17PASS11.93s, UI and adapter-utils typechecks and token gates actual/durable0, final2 pins match. No added copy-mirroring tests. See `brand-runner-display-checkpoint.json`. Transcript fallback names, complete brand inventory and broad V10 gates remain open.


### 2026-10-23 — Preserve unknown payload history after invalidation

Actual valid snapshot clear→NULL→empty-root rebind baseline fails1case21.03s because SQL accepted it. Generated0513 adds one monotonic private bit on six original owners and extends their existing shared binding trigger: only the trigger can latch it; invalidated histories cannot rebind. Existing protocol1NULL is conservatively latched, nonnull proof retained, protocol0 not upgraded. Original containment/body/tenant/digest guards remain. Existing response owner strips only the top-level bit; nested user metadata stays intact. No protocol/receipt/producer activation.

Final actual PG2files11PASS92.55s includes all6 direct/reset/forgedinsert/rebind checks and real Memory evidence/asset invalidation. Root actual historical pre0513 upgrade4PASS23.62s; native snapshot drift1PASS23.10s; DB types/migration checks0. Initial server compiler exposed two unsynchronized original Task list types/selection. Root selects the real DB bit and omits it from generic public return, without invented defaults/casts/relaxed row types. Reviewed actual public API5PASS66.28s and final server compiler actual/durable0; all15 pins match. Initial pnpm wrong-environment refusal and actual compiler failure retained. Root reviewed/corrected bounded gpt-6-luna implementation. See `up04-native-payload-invalidation-checkpoint.json`.

This closes the reproduced known→unknown→fakeknown integrity loophole only. No recovery/restamping API or producer source completeness is implied; all6 binding coverage is distinct from the Task historical upgrade fixture. Complete native inputs/dispatches/tools, current permission/SQL, original private Memory/temporal regressions and broad V10/release gates remain open.


### 2026-10-23 — Full configured workspace typecheck at ba7cd42ca

With the worktree clean before and after, preflight workspace links followed by full recursive `pnpm -r --workspace-concurrency=1 typecheck` completed actual/durable0. This runs configured workspace scripts, including Rust/Runner build prerequisites, server, UI and CLI, with one workspace at a time and bounded CPU/memory. Exact HEAD and raw log retained in `v10-workspace-typecheck-ba7cd42ca-checkpoint.json`. A separate targeted UI run exposed one stale expected permission label after the shared product-name change; it is not hidden by the compiler result and will be corrected next. Full tests/build, actual host/provider/customer qualification and all open V10 privacy/source packages remain open.


### 2026-10-23 — Shared identity in native transcript presentation

Original parser now uses PRODUCT_IDENTITY for five display fallbacks/prefix/adapter-label positions while preserving actual protocol, event, operation, provider and model values. Existing Codex renderer had one stale Allow Paperclip reads assertion after the earlier permission-catalogue change; actual before-run1FAIL/14PASS20.44s is retained and only that directly affected expected copy changes. Final original parser/renderer2files15PASS26.47s, UI typecheck and token gates actual/durable0, final2 pins match. Bounded gpt-6-luna read/edit assistance; Root reviewed and verified. See `brand-runner-transcript-checkpoint.json`. Advanced setup/experimental and complete identity inventory, full tests/build and V10 release gates remain open.


### 2026-10-23 — Bind native Foundation key pins to the authenticated fingerprint

Actual middleware-authenticated Agent/Board requests wait behind a real Source Task row lock; changing and committing the key hash then releasing the lock incorrectly returns200. Baseline2FAIL62.61s retained with exact test source. Original bearer verifier now retains the matched key hash on its internal actor; original pinFoundationActor compares it under existing SHARE NOWAIT and denies missing/changed fingerprints. No raw token, new schema, credential cache or cloned grant policy. Existing principal/scope/revocation/expiry/status semantics preserved.

Full original+new native Source suite12PASS52.13s, unchanged middleware31PASS55.78s, final server compiler actual/durable0, all5 pins match. Both races now deny the pending old credential403, permit the replacement credential200 and reject the old token on fresh authentication401. Root traced/reviewed/verified; read-only gpt-6-luna review found no concrete defect in bounded paths. Test route uses actual middleware and canonical callback, not complete customer Foundation delivery qualification. See `up03-authenticated-key-hash-checkpoint.json`. Broader SQL/key/JWT/session lifetime and complete source/Memory/temporal/V10 gates remain open.


### 2026-10-23 — Preserve verified JWT expiry through the Foundation callback

Two real middleware JWT races returned200 after expiry: one while acquiring an actual locked Source row, one after an allowed decision before callback return. Baseline2FAIL58.10s retained with failed source and pins. Original middleware now retains actual verified claims.exp in milliseconds; canonical pinFoundationActor uses the existing callback deadline and final-return guard. No signer/verifier change, fake clock, new schema/cache or duplicated permission policy. Optional metadata retains trusted non-HTTP native actors.

Final original Source plus unchanged middleware45PASS76.23s; both new cases deny403, freshly minted JWT200 and expired JWT fresh authentication401. Final server compiler actual/durable0, all6 pins match and processes closed. Root reviewed and verified; bounded read-only gpt-6-luna review found no concrete defect. See `up03-authenticated-jwt-expiry-checkpoint.json`. Actual scratch HTTP/native callback coverage does not qualify all customer endpoints, general SQL current lifetimes or session logout. Complete source/Memory/temporal and broad V10/PR/release gates remain open.


### 2026-10-23 — Revalidate real cookie logout after a Source wait

Actual Better Auth signup/signin cookie authenticated through original middleware waits on a real Source Task row. Actual sign-out deletes its session row before release; unchanged Foundation owner incorrectly returns200. Baseline1FAIL76.41s and exact source retained. Original pinFoundationActor now pins supplied sessionId under existing SHARE NOWAIT, same user/live expiry, and reuses final callback deadline. Trusted internal board actors without HTTP sessionId remain supported; normal HTTP middleware supplies one. No auth-library/schema/permission clone.

Final Source and unchanged middleware46PASS99.60s, actual logged-out pending403, new cookie Source200 and old cookie fresh401. Final server compiler actual/durable0, all3 pins match; processes closed. Root reviewed/verified; bounded gpt-6-luna regression/review assistance found no concrete lock-order defect. See `up03-session-logout-checkpoint.json`. This actual scratch HTTP/native callback scope does not qualify all customer routes, general SQL lifetime, complete source closure, original Memory/temporal failures or broad V10/PR/release gates.


### 2026-10-23 — Shared identity in advanced setup and experimental controls

Original advanced Agent saved Runner label now reuses canonical display registry. Instance experimental Runner, Developer Mode, built-in Agent and core Skill explanations use PRODUCT_IDENTITY; providers/identifiers/settings keys, managed Paperclip Cloud attribution and isolation wording remain. Existing sort test genuinely catches changed displayed names left at old P-positions: initial1FAIL/90PASS48.83s retained. Root moves the two original cards to B-positions without changing the alphabetical assertion or adding a sorting abstraction.

Final existing settings/NewAgent/dialog3files91PASS76.64s, UI typecheck/token gates actual/durable0, all3 pins match and checks closed. Bounded gpt-6-luna copy assistance; Root reviewed/fixed/verified. See `brand-runtime-settings-checkpoint.json`. Presentation changes do not qualify physical runtime or complete identity/customer journeys; broad V10/PR/release gates remain open.


### 2026-10-23 — Keep actual staged source handoff and newer native run history

Original executor now forwards actual verified attachment captures to its internal admission boundary. After committed original process-start intent/current analytical check, reuse exact coordinator lease fence and coordinator→run lock order, reread current native running profile, append private bounded per-attempt source facts and recheck authority after commit. Prior entries/other keys and literal NULL unknown snapshots remain; capture-write failure stops admission and cleanup remains original. This is partial source evidence, never a full receipt or grant.

Initial two-case unit baseline has one genuine missing-write failure and one invalid-terminal fixture error; Root corrected the fixture, then genuine2FAIL54.23s. Initial implementation exposed Root outer-only runId reference (2FAIL/2PASS39.03s); corrected local binding. Final complete original executor/stager2files488PASS153.34s. Executor wiring uses mock DB/backend; original stager includes actual PG/filesystem. Physical nonempty-stage executor commit/transport is not implied. Failed sources/pins/logs retained.

Source tracing also found original prepare-native-run replaced its entire profile. Actual PG all3 existing admission-marker modes reproduce newer history/ID loss (3FAIL99.89s). Original locked owner now merges actual current profile, derives3 IDs there, and returns those actual retained/new IDs. Redundant special-case marker retention deleted; all required/historical/invalid semantics remain. Fresh prestarted actual PG final3PASS69.24s, protocol0 unchanged and partial/unknown NULL history preserved. One failed dependency-location cleanup/aborted143 invocation gets no credit; replaced with a fresh database. Original deadlines unchanged.

Final server compiler actual/durable0, all5 pins match; all test/compiler processes and owned PG helpers closed/cleaned. Bounded gpt-6-luna fixture/design/read review assistance; Root corrected, reviewed and verified. See `up03-native-stage-history-checkpoint.json`. Complete input/dispatch/tool/history receipts, copy effects, canonical SQL, original private Memory/temporal failures and broad V10/PR/release gates remain open.


### 2026-10-23 — Shared identity in first-admin and invitation entry flows

Original bootstrap pending and invite/account owners use PRODUCT_IDENTITY for product/user/first-admin/error/fallback labels. Actual CLI compatibility command, adapter ID, invite storage key and auth/gating behavior remain. Bounded gpt-6-luna UI assistance; Root reviewed and traced CloudAccessGate's additional original App test coverage, updating only directly stale displayed expectations.

Existing invite18PASS14.01s and App/access gate14PASS26.84s; UI typecheck/token gates actual/durable0, all4 pins match, processes closed. No new copy-mirroring tests. See `brand-bootstrap-invite-checkpoint.json`. This is UI copy coverage, not live authentication/provider/host qualification or complete brand/localization inventory; broad V10/PR/release gates remain open.


### 2026-10-23 — Factual feedback recipient and explicit terms

Original consent dialogs and General Settings now describe the operator-selected feedback service, matching the original explicit export destination; no upstream or invented legal recipient is asserted. General Settings and Issue Detail show terms only when the operator configures their URL. Original local policy/save/export behavior and consent choices remain. Sign-out reuses PRODUCT_IDENTITY.

Existing three UI suites134PASS59.79s; UI typecheck/token gates actual/durable0, all5 pins match and checks closed. Bounded gpt-6-luna copy reading/assistance; Root reviewed actual export owner, removed implicit upstream terms default and verified. See `feedback-recipient-copy-checkpoint.json`. Complete consent/destination-change/legal/hosted qualification and broad V10/PR/release gates remain open.


### 2026-10-23 — Current native Source lifetime for Task and Project reads

Original callback now reuses canonical NOWAIT authority loaders for Task/Project reads, refuses uncaptured rows and rebinds actual HTTP credential markers. Credential-free internal actors keep existing canonical policy; outside-TX ordinary reads remain per-call. Actual key/JWT/cookie and unlisted-row regressions6FAIL before fix; final original Source/authz/middleware140PASS180.19s.

Actual original metric/strategy consumers initially21FAIL/24PASS, exactly reproduced against committed5d49d9b9a authorization. Replace raw positive Project fixture with actual canonical Board POST; preserve all negative unknown rows/assertions. Reached strategy harness then exposes missing real reviewer and actual40P01 from reverse company/Memory locking; fix these harness facts. Final45PASS201.65s. Server compiler actual/durable0, exact pins match and processes closed. See `up03-native-source-lifetimes-checkpoint.json` for distinct runs/failed sources. General SQL, full input/source graph, private Memory/temporal failures and complete V10/PR/release gates remain open.


### 2026-10-23 — Canonical identity in new account correspondence

Original auth/invitation subjects and account notification subject/message reuse PRODUCT_IDENTITY. Original encrypted outbox, URL, expiry, recipient, dedupe and queued historical payload semantics remain. Existing actual account/invitation/notification three suites30PASS176.38s; final server compiler0 and exact pins match, processes closed. See `brand-account-notification-checkpoint.json`. This is product wording only; CE03 shared EN/DA mail/landing flow and actual sender/provider/hosted qualification remain open.


### 2026-10-23 — First-party feedback from daily account navigation

Both original account menus use intended canonical docs origin and existing first-party feedback composer/event under original feature policy. Production layout mounts that original composer; upstream fallback removed. Original composer current-account/preview/API rules remain. Dashboard/Company Access product labels reuse PRODUCT_IDENTITY.

Actual old production menu fails real-composer component check1FAIL16.58s. First combined run14FAIL/47PASS144.61s includes original5s CompanyAccess timeout with cascading failures and Root wrong standard-menu label selector. Correct only selector; original Account29PASS27.40s isolated and other three suites32PASS117.18s separately. Final UI types/token gates0, exact6 pins match, checks closed. See `brand-daily-navigation-checkpoint.json`. No full layout/browser or deployed docs claim; broad V10/PR/release gates remain open.


### 2026-10-23 — Native local-password policy and legacy sign-in compatibility

Reuse native BetterAuth write middleware for signup/reset/change/internal setPassword. Shared bounded validator enforces 15–128 Unicode codepoints without trimming or composition rules; local pinned MIT whole-password blocklist has 10,898 eligible entries. Native hashing/verifier and unknown-user timing mitigation remain. UI reuses original AuthApiError and safe EN/DA advice; old short credentials still sign in.

Corrected original baseline4FAIL/1PASS/2filtered77.78s, including actual pathless setPassword; initial wrong 15-character negative fixture retained and explicitly corrected. Final actual native server3files30PASS612.88s, dominated by module loading; one-second native inspector import sample did not change clocks/source/assertions. Archived log removes only ephemeral debugger URL. Initial UI5files59PASS126.39s; after a bounded error-selection review, changed Auth/Invite suites42PASS32.97s (overlapping counts). Final shared/server/UI compilers and token gates0, exact pins match and all processes closed. See `local-password-policy-checkpoint.json`. Full CE03 account recovery/MFA/reauthentication/shared bilingual mail/landing flows, full latest workspace checks and complete V10 remain open.


### 2026-10-23 — Shared EN/DA native auth mail and landing language

Original native callbacks retain Request and use shared versioned EN/DA copy with callback-user locale precedence, otherwise actual initiating i18n header, otherwise English. No base-pool lookup during signup. Preserve encrypted outbox/dedupe/expiry/action checks, fixed destinations and safe same-origin return-query context. Original i18n reads validated language only on welcome/reset mail landing, without rewriting saved display choice. Localize legacy welcome and original Activation entry states; original language selector on welcome/reset preserves drafts, with safe errors.

Genuine original mail baseline6FAIL/2PASS14.50s; final original native HTTP/PG auth plus delivery/config3files30PASS94.26s includes decrypted Danish mail. Initial UI10files99PASS/1FAIL104.73s catches new i18n dependency erasing organization draft; Root restores scope-only reset. Exact failed source retained. Final welcome1PASS43.22s; after adding reset selector, original reset/selector13PASS52.72s. Runs overlap; unchanged passing owners retained. Shared/server/UI compiler and final token gates0, all20 final pins match, checks closed. See `auth-mail-locale-checkpoint.json`. Persisted account locale is next, not implied by mocked callback preference precedence. No deployed mail/provider/browser/editorial qualification; full CE03 and V10/workspace/release gates remain open.


### 2026-10-23 — Persist explicit account language at original preference owner

Native generated migration0514 adds nullable constrained locale; BetterAuth reads it privately, rejects native client writes, and forwards actual raw user preference to original auth mail. Preferences partial updates bind expectedUserId, permit locale-only precompany choice, preserve keyboard company audit and untouched fields. Signed-in selector reuses account-keyed owner; public recovery remains browser-only. Respect explicit display/mail choice and intervening language changes; old account acknowledgement cannot change new UI. Supported browser language is the first-visit fallback. AGENTS records personal language scope.

Original routes38PASS37.80s. Initial actual native19PASS/1FAIL149.29s had Root wrong error shape (real CHECK rejects); correct cause.code only. Final actual cookie/preference/mail/config/snapshot3files23PASS133.17s. Initial UI55PASS/22FAIL162.25s includes genuine repeated session observer/refetch/unmount loop; Root reuses checked parent user without weakening original session gate. Two new wrapper fixture failures corrected (mock isolation, resolved account before interaction). Final changed four suites28PASS60.57s; browser/account19PASS7.56s. Counts overlap. Exact failed source/pins and compressed full8.94MB loop log retained. First compiler catches widened native field type; TypeScript-only as const fixes it. Final shared/DB/server/UI types and token gates0, all22 final pins match, processes closed. Original migration generator pruned51 old snapshots to newest five; historical bytes remain at14117bbf7 and SQL history unchanged. See `account-locale-checkpoint.json`. Full CE03, source privacy/temporal/input closure, workspace and V10/release gates remain open.


### 2026-10-23 — Retained private body control rejects policy-only shortcut

Add an actual native-owner negative control: a Task derivative retains a private input even after assignment to another Human; a later Memory produced from that Task must remain withheld from that Human. Original production passes this control1PASS115.08s. The current original three source/privacy regressions still fail178.36s.

Two temporary policy-only candidates were tested and fully restored. Run-only separation still fails the earlier-Memory case114.19s. Applying policy-only traversal to all Memory Task/Project anchors makes that case pass but releases the private body in the new control99.73s. Reject both candidates. Migration0503 already normalizes native Task run binding; missing own Task capture is not the cause. Exact captured payload closure must precede role-aware read changes. Failed candidate source/patches and restored source pins are retained in `up03-retained-body-control-checkpoint.json`. All experiment sessions closed. No production graph fix, complete V10 or release qualification.


### 2026-10-23 — Current HTTP credentials in ordinary private-source SQL

Original privatePrincipalCurrent now checks actual verified Agent/Board key fingerprints, Board key revoke/expiry, actual cookie session ownership/expiry and authenticated JWT deadline with PostgreSQL clock_timestamp. Original private Task/Project/conversation callers share the fix; unmarked trusted server actors keep canonical policy.

Actual HTTP key rotation baseline2FAIL211.24s. Actual JWT expiry/native cookie sign-out baseline2FAIL152.34s against the key-only intermediate. Final native Source/ordinary SQL plus original authorization two suites113PASS279.73s. Initial final command named a nonexistent middleware filename; run the actual agent-auth-middleware suite separately31PASS126.83s. Server compiler actual/durable0, exact final pins match, all sessions closed. See `private-sql-credentials-checkpoint.json`. This proves a fresh SELECT after a preceding blocked statement, not all waits inside a statement or a transaction-scoped source proof. Full SQL/source/input closure, key-scope mutation, public delivery, original three privacy/temporal failures and complete V10/PR/release gates remain open.


### 2026-10-23 — Shared support intake policy

Add the customer-case contract alongside original V6 support-access history. Shared EN/DA categories/impact/status/description wording match §11; only description is required customer input, category defaults Other, impact defaults null and subject/context remain optional. Automatic context accepts only typed removable surface/operation/time/safe-error fields. Published bounds are shared by commands and future UI. Five focused policy cases2.04s and shared compiler both actual/durable0; exact files in `support-case-shared-checkpoint.json`. No case persistence, gateway, privacy lifecycle or complete support-flow qualification yet.


Correction to the shared support checkpoint: Root accidentally replaced the existing test path when adding new coverage. Restore all seven original V6 approval assertions from dba57adfc, merge imports and append the five new cases. Final combined12PASS13.06s and shared compiler actual/durable0; original source bodies/assertions unchanged. Initial five-case evidence remains explicitly limited. See `support-case-shared-restored-checkpoint.json`.


### 2026-10-23 — Durable local support storage and erasure fences

Native generated migration0515 adds tenant-bound cases/events, immutable original input, explicit operator policy, content-free erasure markers, hold/unknown-provider fences and mixed-reader company completion guards. Original company purge, current backup ledger and quarantine replay reuse these owners. Missing V10 ledger section fails closed; current markers override stale restored holds. No customer intake or provider transport admitted.

Final actual PostgreSQL14 storage cases plus original Docker dump/encryption/restore1PASS310.28s; prior storage/feedback29PASS156.75s overlaps and skipped the dump then run in final. Shared policy14PASS2.70s, native ledger5PASS5.017s. Shared/DB/server compilers actual/durable0, final pins match, all sessions closed. Initial FK generation error, startup timeout and negative-fixture correction retained with exact source/logs in support-case-storage-checkpoint.json. Generator prunes0510 snapshot only, historical SQL unchanged. Account erasure linkage and full support lifecycle are next; provider/host, source privacy, full workspace and complete V10/PR/release gates remain open.


### 2026-10-23 — Shared native account/support erasure and quarantine replay

Original account erasure locks affected support roots before feedback roots and deletes only unheld local content without attempted or unknown provider facts. Immediate credential/membership revocation and profile scrub (including locale) share the existing helper with quarantine. Worker completion rechecks support opener/author references. Quarantine preserves only the scrubbed principal and pending operation while held/unknown content remains; releasing a local hold permits actual marker-backed erasure.

Actual original production baseline3FAIL/1PASS/20filtered253.55s; final three original suites44PASS258.07s includes account/support/feedback retention, native session and credential removal, unknown outcome after hold release and repeated isolated restore. Server compiler actual/durable0; exact final pins match and all sessions closed. Brief cloud transport interruption preserved the actual running test process and source hashes. See support-account-erasure-checkpoint.json. This is lifecycle linkage, not a complete support intake/delivery/retention implementation; full source privacy, workspace, V10 and release gates remain open.


### 2026-10-23 — Existing Help/language utilities in the alternative production shell

Replace the original standalone feedback composer with existing ExperienceUtilities safetyRecovery at the same header position. Help and language remain available with progressive shell off, and one composer remains. Actual assembled ProductionLayout test fails against original shell1FAIL19.88s. Initial final45PASS/1FAIL35.44s reveals missing Link in old router mock; reviewed45PASS/1FAIL37.74s reveals existing settings mock overwriting enabled cached test settings. Correct only these fixture facts. Final three original suites46PASS48.56s; UI compiler/token gates actual/durable0, source pins recorded and sessions closed. See production-help-layout-checkpoint.json. Root-coordinated bounded Luna assistance. No browser/manual or complete support, global localization or V10/release qualification.


### 2026-10-23 — Native local support receipt API and retention sweep

Current cookie/Board-key transactions pin native identity, actual company membership and canonical company read policy. Typed local case intake/list/detail/request-key recovery/reply enforce opener versus owner/admin visibility, immutable command retries, customer-safe DTOs and Resolved/Closed reply semantics. Existing execution-control sweeps erase eligible expired local cases with original markers; holds and attempted/unknown external outcomes remain fenced. Account erasure removes native support rate budgets. A deterministic native event ID lets original content-free markers prevent erased-command replay. Shared validation rejects malformed text before the database driver, and native activity publication runs after commit without submitted text.

Actual final HTTP/embedded PostgreSQL plus shared policy25PASS94.07s; earlier erased replay/account/shared33PASS93.81s and broader142PASS203.41s overlap. Initial fixture setup/retention/feature dependency failures and genuine activity publication type failure are retained. The earlier142 and32 runs precede the publication fix; later33 checks actual company events. Final server/shared compilers actual/durable0 and exact seven source pins match. See aw-v10-evidence/support-cases-2026-10-23/checkpoint.json. No external gateway/operator response, uploads/diagnostics, case-linked privileged session, export, browser/host or whole support/V10/PR qualification. Source privacy blockers and latest full workspace checks remain open.


### 2026-10-23 — Native customer support page and persistent Help entry

Both shells expose language, native support entry and direct human contact independently of progressive shell. New account/company-bound page uses shared policy, native router and query owners for receipt/history/reply/recovery, safe removable context, pagination, exact EN/DA input labels and accurate delivery state. Current session/authority changes hide and remove private caches; late acknowledgements cannot update another account/view. Same-context refresh preserves drafts. Return pathname remains UI-only, company/user-bound and rejects foreign/network-path/normalized traversal targets. Cancel preserves the mounted draft and shares the native footer row with Send.

Final case page10PASS21.40s; original history8PASS26.09s and original App routes/access16PASS88.15s. Existing Layout/history41 passing tests remain in the initial return run47PASS/3FAIL47.36s; only wrong new fallback assertions failed. Earlier composed45PASS/1FAIL37.62s catches an old generic select fixture choosing language rather than Page section. A reviewed command named a nonexistent history test, so only38 tests ran; actual history8 ran separately. Final UI compiler/token gates actual/durable0; all eight source pins match, processes closed. See aw-v10-evidence/support-cases-2026-10-23/ui-checkpoint.json. Component/router evidence only; no browser/manual accessibility, crash recovery, upstream work-draft preservation, Help search/incident/assistant, gateway/operator/close/upload/session or full SUP/V10/PR qualification. Source privacy and latest full workspace gates remain open.


### 2026-10-23 — Authenticated customer case closure

Native close command reuses the existing pinned Board/member/case transaction, strict shared command schema, request identity and after-commit activity. Fixed stored-account EN/DA customer action message marks canonical CLOSED with history retained; later replies create the original linked follow-up. Same-key retries have one effect; already-closed new-key commands change no events/version/retention. Closing retains the original policy even when new intake is unavailable. UI uses the existing reply operation owner for close/recovery, preserves unsent reply text, shows active action and exact policy limits, and restores keyboard focus for Cancel/Resume.

Actual HTTP/PG15 plus shared14PASS160.01s; earlier API13PASS113.94s overlaps. Native DB twenty-per-ten-minute budget survives route reconstruction and actual window expiry; no real-process restart claimed. Final UI11PASS19.74s supersedes overlapping11PASS60.10s before active-action/focus refinement. Earlier UI fixture used the wrong ApiError argument order and was corrected before final checks. Shared/server/UI compilers and final token gates actual/durable0; native API first four pins unchanged and final action pins match all eight current sources; sessions closed. See aw-v10-evidence/support-cases-2026-10-23/close-checkpoint.json. No external provider/operator callback or complete V10 qualification. Original work preservation, export, gateway, uploads, case-session linkage, source privacy and full latest workspace/release gates remain open.


### 2026-10-23 — Keep the originating work mounted while Help is open

App retains its actual originating Location in memory, bound to the current company, principal and native session. Help navigation carries only a route key, same-company return pathname and existing safe context. Existing React Router routes remain at the original location while the native Radix dialog shows support; case selection replaces the dialog URL so returning preserves the actual work route/query/hash/state. Current account recheck hides the underlay without unmounting it; session/principal/company changes discard it. Direct support links remain standalone. Native dialog focus returns to the actual Help entry, and its existing account language selector remains reachable inside the focus trap. No draft body or permission data enters support navigation state or payload.

Initial three-suite run15FAIL/11PASS136.64s,16uncaught errors catches missing account query provider in older route fixtures; original assertions retained with scoped account mocks. Reviewed3FAIL/27PASS100.83s catches portal assertions querying the route container instead of document.body; fix waits and failure-safe cleanup. Combined four suites44PASS177.02s. After adding native language control inside the dialog, changed App routing6PASS59.85s; final UI compiler/token gates actual/durable0, six final pins match and all sessions closed. Real App/utility/router/Radix composition, with controlled account and domain work/support fixtures; no full production composer/browser/API-auth or crash qualification. See aw-v10-evidence/support-cases-2026-10-23/work-preservation/work-preservation-checkpoint.json.

Remaining support acceptance includes durable minimal command-key recovery across reload (without plaintext draft storage), support draft handling on modal dismissal, native case export, operator/gateway/erasure lifecycle, uploads/diagnostics, case-linked V6 access and grounded optional assistant. Before external transport admission, create/reply must bind the customer-observed processing-policy version to prevent stale disclosure across configuration replacement. Source privacy, full latest workspace checks and complete V10/PR/release gates remain open.

### 2026-10-23 — Minimal native history request recovery

Before command dispatch, native router history retains only company/principal-bound command key/kind/optional case UUID and existing allowlisted navigation/context metadata. No description/reply/subject or arbitrary prior route state is copied. Remount performs read-only receipt lookup; unknown outcomes require explicit re-entry/retry with the same key. Another case cannot receive a restored reply/close. Already-CLOSED no-op closure remains retryable and clears the technical intent after acknowledgement. History failures share existing command error handling; no automatic POST or second persistence framework.

Initial11PASS25.66s and reviewed15PASS25.41s are earlier source checkpoints. Final combined20PASS/1FAIL79.97s exposed a native Dialog focus timing race; preserve its exact assertion and wait for scheduled auto-focus. Reviewed final two suites23PASS86.17s, UI compiler/token gates actual/durable0, five exact source pins match and all processes closed. See request-recovery/request-recovery-checkpoint.json. Controlled MemoryRouter remount/API fixtures, not physical-browser crash or live auth qualification. No complete support/V10/PR claim; remaining source/privacy and full latest workspace gates stay open.

### 2026-10-23 — Visible support archive, concurrent quota rows and native browser recovery

Company portability now offers a separate default-off informational support archive through the original support authorization transaction, with full visible timeline pagination, counts, content hash, exclusions and bounded rejection instead of truncation. Selected archive import is rejected before materialization. The UI checks the actual current session before command and acknowledgement. The four custom rate-budget owners keep their logical quota keys but use independent UUID row identities, avoiding a second uniqueness conflict outside the key upsert arbiter.

Final four native suites107PASS215.05s include32 concurrent support-create pairs and exact logical budget counting. Route44PASS32.36s, UI31PASS43.99s, shared/UI/final server compilers and token gates exit0. Initial combined portability157tests/71failures remains preserved:54 service export tests lack native actor/company fixtures,8 service imports need explicit source publication,9 route argument assertions were corrected and passed. The earlier23505 diagnostic did not capture an exact constraint; do not claim a proven index name. All21 final source pins match and actual sessions closed. See export/support-export-checkpoint.json.

Actual Chromium against production UI build, native cookie authentication and embedded PostgreSQL passes both response loss after durable acceptance and interruption before acceptance. Reload performs receipt GETs; only explicit retry POSTs with the original key. Actual Work heading node remains connected through Help/return and exact Help focus returns. Final1PASS1.6min, gracefulSIGTERM closes its isolated database/socket. Two intermediate root selector mistakes and a stale test socket failure remain archived. Browser discovered invitation bearer tokens in successful mounted-route URLs; shared URL redaction now covers native/mounted/browser invite paths and actual success/failure logger canaries. Final sanitizer/logger137PASS3.01s. Two archived earlier browser logs have one synthetic invite token each redacted; original/archived hashes and counts retained. See browser/browser-checkpoint.json.

This qualifies bounded synchronous export and reload behavior, not durable export jobs/download reauthorization, a physical process crash, full Task-composer draft, external gateway/operator processing, manual accessibility or complete SUP/V10. Customer-observed processing-policy binding, source privacy/temporal failures, original portability service failures and latest full workspace gates remain open. Read-only source audit confirms original Task/Memory payload snapshot writers are still absent; adding another partial capture cannot count as complete provenance or enable policy-only reads.

### 2026-10-23 — Bind customer-observed support processing before accepting new text

The customer disclosure includes an opaque SHA-256 revision of the full parsed operator policy. Create/reply require that exact observed revision before storing a new case/event, including recipient, notice, region or retention changes with a reused configured version name. A durable original command still recovers its original receipt before evaluating replacement configuration. Existing cases retain their original immutable processing policy and cannot silently move replies to another recipient. Closure remains independent of intake availability. The revision is consistency metadata, not authority or delivery proof.

UI preserves rejected description/reply text and return navigation, refreshes disclosure, disables new text commands while rechecking, and waits for an explicit send. Definitive policy rejection clears only that attempt; uncertain attempts keep their original immutable payload/key. Shared/UI34PASS16.98s; actual authenticated native HTTP/PostgreSQL52PASS63.21s, including four same-version policy replacements, unchanged original retries and zero rejected-command events. Final production UI/native cookie/Chromium recovery1PASS1.8min covers both interruption phases under the required revision contract. UI/server compiler and token gates actual/durable0; all eight exact source pins match, all sessions closed, test PostgreSQL socket absent, raw browser log invite paths masked. See policy/checkpoint.json. No external dispatch, operator processing, privileged support access, full source privacy or complete V10/PR qualification.

### 2026-10-23 — Restore current native authority in source-free portability fixtures

Eighteen original company/agent/skill/package formatting tests now export through the existing real native DB/company/current Board owner fixture. The permission-grant case uses actual grant rows instead of a fake select result. Domain serialization inputs remain controlled; original formatting/import assertions and target modes are preserved. No authentication mock or source-bearing publication bypass was introduced.

Initial two-skill check2PASS/94filtered36.78s follows an environment-interrupted attempt with no observable exit/result. Exact prior test source retained. After the larger fixture batch, the full original96-test file reports52PASS/44FAIL plus1original unhandled error in28.98s,actual/durable1. All18 migrated fixtures pass; remaining36 export fixtures and8 cross-company publication/import conflicts stay unresolved. Full suite is not green. Final product compiler checkpoint predates these test-only edits (server tsconfig excludes __tests__); no product code changed in this batch. Exact current source and log pins retained in portability-fixtures/checkpoint.json. Source privacy and latest full workspace/V10/PR gates remain open.

### 2026-10-23 — Native source rows in original portability format tests

Eight further agent/package fixtures retain a consistent native company through export and import. Root corrected intermediate one-shot company lookups, remaining old-ID assertions and controlled profile IDs without weakening expectations. Three original Project/Task formatting cases now seed actual new open Human-authored source rows/UUIDs. Project fixtures use the original Board-create stamp and empty retained roots for new rows only; no historical or imported payload is promoted to qualified or given a fabricated snapshot. Controlled project projections include the native ownership/source fields; this is bounded formatter/service evidence, not actual HTTP creation or complete provenance qualification.

Final full original96-test file63PASS/33FAIL48.63s,actual/durable1,zero unhandled errors. All29 migrated fixtures pass; the bounded-concurrency test retains its exact assertion/500ms threshold. Earlier38/38/37/35-failure stages and exact source captures remain. No full portability, source privacy or V10/PR pass. See portability-fixtures/checkpoint.json. The33 original source-bearing/export/import/routine/publication failures remain open.

### 2026-10-23 — Shared quota windows use PostgreSQL statement time

All four existing account/feedback/image/support upserts use the database statement clock, preserving the same native quota key, independent UUID identity, counts, windows and erasure cleanup. The image reservation path also avoids a separate clock query. Application clock skew cannot reopen a quota window; no new helper/cache/table or generalized rate-limit engine was added. Other account/credential time decisions are outside this change.

Actual new skew regression against the original code1FAIL/52filtered55.10s: a one-hour application-clock advance reset the stored count to1 rather than2. Exact original owner source captures retained. Final four original native suites112PASS188.75s; final server compiler actual/durable0, four exact source pins match and all sessions closed. See rate-clock/checkpoint.json. Injected process-clock skew against actual PostgreSQL, not two physical replicas/restart, full workspace or complete V10 qualification. Original source/privacy and portability contracts remain open.

### 2026-10-23 — Native Task updater invalidates changed payload captures

The original Task update transaction compares the effective candidate row with its locked current row using the existing PostgreSQL body hash. Changed payload bytes explicitly clear the old snapshot, allowing the original database trigger to latch irreversible invalidation. Unchanged text/JSON and operational updates retain their capture. Column metadata and SQL expressions use the existing Drizzle representation; no duplicated body-field registry or relaxed database trigger was added.

Both new regressions fail against the original updater with SQLSTATE23514 (2FAIL/6filtered41.60s). Final original binding suite8PASS40.04s includes SQL-expression counters, canonical JSON equality, text/JSON changes, unchanged direct-write rejection and no rebinding. Server compiler actual/durable0; final source pins match and sessions closed. See task-body-invalidation-2026-10-23/checkpoint.json. Structural fixture evidence only; other native writers, authenticated constructors, complete input receipts and the original privacy/temporal regressions remain open. No protocol or read-path admission follows.

### 2026-10-23 — Environment clearing and two original export fixtures

Native removal of a Task's selected execution environment now clears its old payload capture in the same UPDATE and carries company scope through the write predicate. A new actual PostgreSQL regression preserves snapshots/settings for another environment and another company. Baseline1FAIL/8filtered50.84s reproduces the original stale-snapshot rejection; final binding suite9PASS. Other body mutation owners still need coverage before any constructor activation.

Two further original export formatting fixtures use the existing current native company/Board actor and newly inserted Human Project/Task source rows. Actual ownership/source fields are retained in their controlled formatter projections; original Git metadata and environment-secret redaction assertions stay unchanged. Combined run73PASS/32FAIL137.02s comprises binding9PASS and portability64PASS/32FAIL. The original500ms concurrency assertion takes1674ms while the compiler overlaps. After compiler closure, both migrated fixtures plus that unchanged concurrency assertion pass3PASS/93filtered30.34s. The31 other original portability failures remain open; no full suite pass is claimed. Final server compiler actual/durable0, three source pins match and all sessions closed. See task-environment-invalidation-2026-10-23/checkpoint.json. No authenticated source-constructor, complete V10 or PR qualification.

### 2026-10-23 — Memory capture integrity after source retention and erasure

The Memory retention BEFORE trigger can rewrite five arrays included in the body hash, but previously ran after payload binding. Actual regression reproduces a snapshot accepted against the attempted row before the retained arrays are restored (1FAIL/10filtered43.87s). Native custom migration0516 moves binding after retention and invalidates existing snapshots whose hashes no longer match the stored body; the existing irreversible unknown latch remains authoritative. No historical payload is restamped. Native snapshot pruning retains the latest five generated snapshots.

Memory root purge explicitly clears its snapshot with the erased body. A separate actual baseline without evidence rows reproduces the stale-snapshot erasure rejection (1FAIL/9filtered52.04s); evidence deletion is no longer an incidental prerequisite. Final original binding suite12PASS40.85s includes replay of the actual migration over an inconsistent old-order fixture inside one physical transaction, retained source preservation and rejected rebinding. Migration safety and server compiler actual/durable0, five final source pins match and sessions closed. See memory-capture-erasure-2026-10-23/checkpoint.json. Other effect/erasure writers, complete input receipts, original privacy/temporal regressions and full V10/PR gates remain open. These are structural integrity fixtures, not authenticated source producer qualification.

### 2026-10-23 — Clear support drafts on same-principal session replacement

The support page's native account key includes the current session, clearing all local draft and uncertain-attempt state on a genuinely replaced session even when the user/company stay the same. Query cleanup uses the same session prefix, so the departing component cannot cancel/remove the replacement session's requests. Effective private read keys are unchanged. Same-session account rechecks retain their existing state.

The original late-acknowledgement regression now runs for both principal and same-principal session replacement, preserving its assertions. Baseline1FAIL/1PASS/18filtered17.57s reproduces the retained old-session draft; final page20PASS10.56s. UI compiler/token gates actual/durable0, two final source pins match and sessions closed. See support-session-draft-2026-10-23/checkpoint.json. Controlled React/router/query identity fixtures only, not actual cookie/browser session qualification. Modal-dismissal draft retention, complete support/source privacy and full V10/PR gates remain open.

### 2026-10-23 — Preserve support drafts with native React Activity

Installed React19.2.8 Activity retains the existing support component only within the same company/user/session. Dismissal hides its portaled DOM and disconnects native Radix modal/focus/pointer effects and private query subscriptions; direct standalone support and scope changes discard the retained component. Original work remains mounted and usable after dismissal. No forceMount, custom draft store, added dependency or browser text storage. In-flight refs reconcile the busy state on reveal; original immutable attempts remain explicit retries.

Reopening Help creates a fresh history entry. A focused regression catches the missing technical intent (2FAIL/21filtered25.24s). The original component restores only key/kind/caseId under its current-session gate, allowing a subsequent reload to find the receipt without serializing draft text or automatically posting. Final two original UI suites35PASS51.25s cover three dismissal methods, released pointer/scroll/accessibility effects, hidden scope erasure and accepted/uncertain create/reply outcomes. Earlier29/34/35-pass source stages retained. UI compiler/token gates actual/durable0.

Actual Chromium151, production Vite UI, real cookie login and native PostgreSQL/HTTP suite1PASS1.6min (test33.0s). All three dismissal mechanisms preserve the unsent support draft, original work node and exact Help focus. Lost accepted response survives dismissal/reopen and reload, recovering the original one-event case without another POST. Existing before-acceptance reload/original-key retry remains; total3POST attempts/2cases. Graceful SIGTERM closes API/PG ports and removes the PG socket; zero raw invitation path segments in the archived log. Six final pins match and processes closed. See support-activity-2026-10-23/checkpoint.json. Scope-replacement/async details remain controlled identity/API evidence; no physical crash, full Task-composer draft, manual accessibility, gateway/provider/session, source privacy or complete V10/PR qualification.

### 2026-10-23 — Plugin policy writers preserve or invalidate the actual body capture

The original Task and Project plugin-policy writers compare their actual JSONB field with the new native policy inside the same UPDATE. Unchanged bodies retain the capture; changed bodies clear it and use the existing irreversible invalidation latch. Company scope now travels through both write predicates. No new authority or source qualification is conferred.

Initial2FAIL/5filtered47.16s reproduces stale bindings; the Project fixture also lacked the native enabled:false normalization, retained in the raw baseline capture and corrected before final unchanged-body assertions. First full7PASS66.28s precedes explicit policy-result assertions. One later collection was stopped withSIGTERM/actual143 and no test summary. Isolated final7PASS147.08s includes original access/grant/audit checks and both actual policy-result/body-capture cases. A two-second collector CPU sample records Vite source-map/parse work; no product performance claim. Server compiler actual/durable0, both final pins match, processes and local inspector closed. See plugin-policy-capture-2026-10-23/checkpoint.json. Structural fixtures through original host owners only; complete authenticated producers, privileged credential lifetime, other body writers and full V10/PR gates remain open.

### 2026-10-23 — Native forecast, monitor, blocker, workspace retry and derived erasure writers

Forecast reason changes now clear the old Task capture in the original locked update; unchanged reasons with changed forecast dates/confidence preserve it. Three native monitor transitions explicitly clear captures and carry company scope. Failed-workspace retry clears only when detachment changes the stored preference; blocker binding compares actual JSONB and preserves unchanged descriptors. Five original Memory-derived Task/Comment/revision erasure updates clear their captures with the erased bodies. Forecast HTTP responses reuse the existing public-row projection, keeping all three internal proof fields server-side.

Actual forecast baseline1FAIL/13skipped38.42s and corrected erasure baseline3FAIL/12skipped54.76s reproduce SQLSTATE23514. Initial erasure fixture omitted Agent origin identity and is retained separately. Final roadmap14PASS41.71s; monitors9PASS77.24s at the archived pre-retry owner source; retry51PASS within the initial combined82-test run (2 unrelated status fixture failures); corrected status31PASS56.98s includes all53 production-consumer corpus scenarios. Binding15PASS within the initial broader erasure run, and final original erasure/public HTTP17PASS65.39s. Server compiler actual/durable0; native test files are excluded from that compiler and their evidence is the actual test runs.

Original fixture assertions remain: new Projects receive the original Board-create source stamp only at INSERT; authorized corpus writes use an actual stored Human/membership; adversarial origins use new rows instead of bypassing immutable identity. New malformed origins must be rejected by the DB and remain absent. Initial fixture failures and exact prior sources/logs are preserved in native-body-writers-2026-10-23/checkpoint.json. All12 final source pins match; sessions closed. These are structural body/invalidation and controlled HTTP-serialization checks, not authenticated producer, complete input receipt or source-free admission qualification. Other Project/Comment/Memory/Document writers, the original3 privacy/temporal failures,31 substantive portability failures and latest full workspace/V10/PR gates remain open. No constructor activation or source-binding guard relaxation.

### 2026-10-23 — Project/Comment body capture and atomic environment removal

The original locked Project updater compares its effective candidate against the existing DB body hash, preserving unchanged text/canonical JSON and operational changes while invalidating changed bodies. Comment tombstone compares the actual cleared fields, preserving a capture when only deletion metadata changes. The native Project policy parser retains the existing environmentId contract. Both original Task/Project environment-removal owners now use a single company-scoped jsonb_set UPDATE, preserving unrelated current fields and rechecking the matching environment after row-lock waits; the former scan/update loops are removed.

Initial4-case failure reproduces three stale-snapshot23514 errors plus the parser dropping the Project environment selection (count0). First binding/helper50PASS42.11s precedes the atomic change. Actual competing-transaction regressions2FAIL/19skipped57.79s observe the native UPDATE lock and reproduce both overwritten replacements/count1. Final atomic stage57PASS/3FAIL101.60s contains binding21/helper31/shortname5 passes and three old route fixtures failing against an empty fake DB. The latter now use actual stored Human/admin/company rows and native Project create/update; final3PASS50.95s retains original env normalization, secret-log and lifecycle assertions plus physical transaction/actor forwarding. The intermediate native route matcher failure and its compressed transaction-object dump are retained (credential-pattern scans0); no combined60PASS result is claimed. Server compiler actual/durable0, exact product pins unchanged, all sessions closed.

See project-comment-writers-2026-10-23/checkpoint.json for exact captures, source pins and limitations. Secret normalization/activity projections and actor transport remain controlled; this is not HTTP credential, provider, complete producer/input receipt or source-free admission qualification. Other direct Project/Comment/Memory/Document writers, original privacy/temporal and portability failures, and latest full workspace/V10/PR gates remain open. No constructor activation or binding-trigger relaxation.

### 2026-10-23 — Roadmap policy and managed Project reset capture

Original Project policy and plugin-managed reset writers preserve unchanged bodies and invalidate changed bodies in the same native UPDATE. Policy compares canonical JSONB and carries company scope; managed reset compares the exact three hashed fields it writes (name, description, color), leaving operational status-only changes bound. Actual2FAIL/21skipped41.62s baseline reproduces23514 after unchanged-body controls; final binding23 plus original roadmap/playbook14 gives37PASS63.82s, with no baseline fixture/assertion corrections. Server compiler actual/durable0, three pins match and sessions closed.

See project-policy-reset-2026-10-23/checkpoint.json. New INSERT-only protocol1 snapshots are structural fixtures; actual stored Human/owner membership/grants cover the policy service, while managed reset exercises the original internal owner. No plugin worker/provider, actual HTTP credential, complete authenticated producer/input receipt or source-free admission qualification. Comment metadata, Memory/Document writers, the original privacy/temporal and portability failures and full workspace/V10/PR gates remain open. No constructor activation, historical upgrade, rebind or read-path relaxation.

### 2026-10-23 — Comment metadata and Memory dedupe capture

The native Comment presentation upgrade compares actual JSONB and clears a changed capture in its original company-scoped UPDATE. Original Memory dedupe clears the canonical capture when adding an actual duplicate root; the superseded duplicate retains its exact snapshot. Actual baseline2FAIL/25skipped56.80s reproduces SQLSTATE23514 and the failed native worker. Final two original suites27PASS63.34s include lease-expiry rollback and committed-publication checks. Server compiler0; exact four pins match and sessions closed.

See memory-comment-capture-2026-10-23/checkpoint.json. INSERT-only protocol1 structural fixtures confer no producer/input-completeness or source-free admission; no constructor activation, historical upgrade or relaxed binding guard. Other Memory/Document/attachment writers, original privacy/temporal and portability failures, and full workspace/V10/PR gates remain open.

### 2026-10-23 — Native Memory, Attachment, Learning erasure, budget and queue captures

Memory duplicate attachment clears its capture only for actual new retained sources; first revocation clears the changed mandatory reason, while already-revoked/no-new-source controls preserve exact snapshots. Attachment-to-Comment binding clears the old capture in its original company-scoped UPDATE. Native generated custom0517 invalidates the affected retained attachment before Comment hard deletion changes its FK, across native deletion owners. Another binding is untouched. The original Learning DB erasure guard clears the actually erased revision capture; its fixed marker and immutable/verified-output guards still reject unrelated field changes. Budget pause/resume and queued Comment edits preserve unchanged bodies and invalidate changed ones, with company predicates retained.

Actual native stage39PASS in four files (binding27,Memory3,private-lineage6,budget/queue3); that5-file process exits1 because a separate new Learning policy regression stops on an unqualified common fixture before its writer. No5-file pass claimed. Earlier baseline and fixture failures are retained, including the original immutable-revision rejection after the first snapshot fix. Final migration safety and server compiler0; ten tested pins match and sessions closed. See native-mutable-payload-owners-2026-10-23/checkpoint.json. No complete input receipt/producer or source-free admission, constructor activation, historical upgrade, provider proof, full V10 or PR qualification. Separate Learning-policy/Telegram writers, original privacy/temporal and portability failures, and workspace gates remain open.


### 2026-10-23 — Minimize browser authentication diagnostics

The original auth client logs only fixed request metadata for network failures and method/URL/status for HTTP errors. Page URLs, arbitrary Error objects/messages, response bodies and reason phrases no longer enter console diagnostics. Original native errors, auth codes, status and caller behavior remain unchanged. No redaction framework or added dependency.

Initial6-test run4PASS/2FAIL includes a missing-window fixture error; the corrected node-environment fixture reproduces both actual leaks (4PASS/2FAIL11.97s). Final6PASS13.41s covers invitation paths, query tokens, arbitrary error context and response/OTP canaries while retaining diagnostic metadata and original errors. UI compiler and token gates actual0; sessions closed. The corrected baseline fixture was not archived before whitespace cleanup, so no exact baseline test source pin is claimed. Final source pins and raw logs are in auth-client-diagnostics-2026-10-23/checkpoint.json. Controlled fetch/console evidence only; current source privacy, account authentication features and full workspace/V10/PR qualification remain open.


### 2026-10-23 — Learning policy and Telegram failure body captures

The original Learning roadmap policy acceptance and Telegram attachment-only failure settlement retain unchanged captures and clear changed captures in the actual company-scoped UPDATE. The unchanged-body assertion reaches the original policy writer before its changed-policy regression reproduces23514; corrected bound Telegram failure likewise reproduces23514. The initial Telegram hook timeout and fixture failure are retained separately.

Broader actual run64PASS/19FAIL470.21s includes all four binding/Memory/private-lineage/budget-queue files, both selected Telegram cases and the new policy capture case passing;19 original Learning cases fail. Subsequent fresh Project fixture correction yields4PASS70.57s. Correct native actor/account/run fixtures yield4PASS/4FAIL73.98s, then2PASS/2FAIL71.90s; the two remaining no-wait Workflow cases identify the actual typed-origin mismatch. Positive source-linked Foundation/Workflow reads carry owner; existing actorless negatives, wrong citation, self-review, Stop and late-erasure assertions stay.

Both candidate/active Skill lifecycles and both accountable preparation/native Context cases pass together4PASS140.44s (102.06s actual tests) under a120-second complete-lifecycle test budget. Earlier30-second expiry and isolated cold mandatory Context timeout remain raw evidence. Profiling observed live queries without blocking PIDs; no production timeout, permission bypass or performance qualification is introduced. Instrumentation is removed from final sources. Final server compiler actual0 before the separate authentication schema work; product pins remain unchanged, tests excluded. See learning-telegram-capture-2026-10-23/checkpoint.json for exact stages, pins and limitations.

Confirmed open production defect: native Workflow Tasks store workflow_runs.id in originRunId, but Task mutation and generic privacy traversal assume heartbeat_runs. Do not repair this by flipping fixture flags, discarding provenance or relaxing source denials. Four original Optimizer cases and two no-wait Workflow cases need a truthful typed origin/source-owner repair. Full original Learning, source privacy/temporal, portability and whole-workspace/V10/PR gates remain open. No complete source producer, provider or PR-ready claim.

### 2026-10-24 — Native password proof and authenticator lifetime foundation

The existing Better Auth owner now records completed email/password signup and
sign-in on the actual native session, against the trusted captured user generation
and database clock. Private assurance fields reject client writes and remain out
of native HTTP responses. Historic sessions, cookie refresh, reset links and SSO
are not backfilled. New generated 0518/0519 provide exact official provider models,
credential/factor generation guards, concurrent authority pinning, monotonic
passkey counters and final-key retention. The original account erasure owner also
destroys authenticators while a scrubbed principal remains; its canonical deletion
marker permits irreversible erasure and quarantine replay, not recovery access.

Native challenge handling in Auth and InviteLanding preserves intended navigation
and supports maintained TOTP/recovery endpoints without logging secrets. The
account confirmation input and shared API validator accept the full supported
Unicode password bound, with original native verification and legacy short
credential compatibility preserved. Official passkey dependencies are pinned to
the maintained provider version; MFA/passkey plugins are not yet activated.

Actual PostgreSQL/HTTP stages: three complete native suites pass 26 tests; after
the matching Unicode confirmation bound, the complete account suite passes 11,
including the added 128-astral-codepoint confirmation. Verified-mail/recovery
regression passes 4. UI Auth/API/InviteLanding/Account suites pass 74. Final server
and UI compilers, token gates and native migration safety return zero; all sessions
are closed. Server compiler excludes tests. Initial lifecycle assertion mistakes,
the obsolete retained-session fixture, and the reproduced retained-factor erasure
failure remain in raw evidence. Exact archived erasure baseline, final pins and
bounded stages: native-authentication-lifetime-2026-10-24/checkpoint.json.

V10-166 remains in progress. Full enrollment/removal/recovery UI, native factor
proof completion, recent-action checks in the actual mutation transaction,
operator phishing resistance and bootstrap/recovery admission remain open.
Pending passkey registration JSON also needs generation binding and user-data
erasure before activation; the simple TOTP verification-value cleanup does not
reach that provider shape. Structural factor/key fixtures do not qualify MFA,
WebAuthn, physical authenticators or restored-backup MFA. Existing source
privacy/temporal, typed Workflow origins, portability and whole-workspace gates
remain open. No full V10, provider deployment or PR-ready claim.

### 2026-10-24 — Native password reauthentication and attempt lifetime

The existing native policy plugin exposes password reauthentication through the
maintained Better Auth checker. It obtains the actual session/user generation
from PostgreSQL before verification, because native session middleware returns
public fields, then stamps current proof only if that original generation,
session, credential and erasure state still hold. Existing private proof fields
and native sessions remain the sole authority. Canonical erasure markers deny
fresh authority even if stale credential/session material reappears.

A database-clock principal budget commits under actual user/session lifetime pins
before verification. Bad-password and rate-limit responses retain their attempts;
locked, absent or erased identities cannot create that row. The original account
erasure owner clears it. The native IP limiter remains an additional guard.

Initial three-suite stage passes 31. Additional physical-lock and erased-marker
assertions reproduce two failing cases/four assertions, including a persisted
attempt on locked admission. The corrected complete PostgreSQL/HTTP suites pass
32, with actual native verifier/committed password-rotation interleaving and two
native instances sharing one principal budget. Auth client regression passes 10;
final server/UI compilers and token gates return zero and sessions close. Server
compiler excludes tests. Exact stages, baseline archives and final pins are in
native-reauthentication-2026-10-24/checkpoint.json.

V10-166 remains in progress: same-session password proof is not full factor
integration. Native session rotation/fresh-age compatibility, protected native
factor transactions, actual MFA/WebAuthn ceremonies, full UI, operator/bootstrap
and enterprise recovery remain open. Two test instances in one process do not
qualify deployed replicas or restart/failover. Structural stale-erasure fixtures
do not qualify encrypted-backup restoration. Prior privacy, Workflow-origin,
portability and whole-workspace/V10/PR gates remain open.


### 2026-10-24 — native password session rotation

The existing password reauthentication endpoint now rotates the actual native session in a proof-pinned physical PostgreSQL transaction, with cookie rollback and native hooks after commit. Complete credential HTTP/PostgreSQL suite: 14 pass; server compiler: zero. Evidence: `doc/operations/aw-v10-evidence/native-session-rotation-2026-10-24/checkpoint.json`. MFA/passkey ceremonies, operator/enterprise recovery and the overall V10/PR gates remain open.


### 2026-10-24 — typed native challenge cleanup

Migration 0520 and the original account erasure owner remove the maintained passkey provider's identity-bearing JSON challenges on actual authenticator generation change or user erasure. Owned challenge writes pin a live, non-erased user. Three prior-product regression cases fail; final three complete native suites: 37 pass, migration checks/server compiler: zero. Evidence: `doc/operations/aw-v10-evidence/native-challenge-lifetime-2026-10-24/checkpoint.json`. Structural fixtures qualify storage/lifetime only. Full MFA/passkey ceremonies, operator and enterprise recovery and V10/PR gates remain open.


### 2026-10-24 — native TOTP/recovery and sensitive account actions

The maintained native backend now composes TOTP/recovery verification with first-factor generation binding, independent durable attempt reservation, current-factor completion and actual native session rotation. Configuration, password change and irreversible personal exit require current proof; exit also requires an actual same-user session, with prior structural fixtures corrected accordingly. Initial2 native lifecycle cases pass; staged4-suite runs pass42 then44; final server compiler and migration checks return0. Evidence: `doc/operations/aw-v10-evidence/native-two-factor-2026-10-24/checkpoint.json`. Same-code TOTP replay within its accepted window still requires an atomic consumption fence. Settings/enrollment UI, passkeys/operator/enterprise recovery, other sensitive owners and complete V10/PR gates remain open. No release/readiness claim.


### 2026-10-24 — one-use verified TOTP completion

Existing factor metadata now atomically consumes already verified OTP fingerprints across challenges and credential/recovery-code changes. Consumption commits before session publication and survives later native session-write failure; actual old-session proof remains physically pinned. Original replay baseline1case/3assertions fail; initial rollback baseline1case fails. Staged complete native runs46→47→48 pass; final server compiler and native migration checks0. Evidence: `doc/operations/aw-v10-evidence/native-totp-replay-2026-10-24/checkpoint.json`. UI/enrollment, expected-principal binding, passkey/operator/enterprise and full V10/PR gates remain open. Native production clock/replica/backup qualification is separate.


### 2026-10-24 — actual native authenticator settings lifecycle

Account settings now cover maintained TOTP enrollment/verification, recent
confirmation, one-time recovery display/replacement, disabling with forced
sign-out and retry-safe pending cancellation in EN/DA, outside paid capability
gates. Actual expected-user/session preconditions and response-session matching
withhold stale private replies. The full built-app browser found and drove fixes
to synthetic session IDs, status/cookie rotation races and stale query refreshes.
The complete real-cookie/PG/maintained-crypto browser lifecycle now passes.
Evidence: `doc/operations/aw-v10-evidence/native-authenticator-settings-2026-10-24/checkpoint.json`.
This advances CE-03; passkeys/operator bootstrap, enterprise restrictions, other
sensitive owners, the original source-privacy/portability regressions and full
V10/PR gates remain open. No PR-ready, release or host/provider claim.


### 2026-10-24 — maintained local passkey ceremonies and private error boundaries

Configured-origin local passkeys now use the installed maintained provider,
actual verified UV callbacks, pre-verification generation/key pins and one-use
native challenge consumption committed before protected writes. EN/DA account
controls provide creation, confirmation, rename and removal without paid gates;
real anonymous passkey sign-in is available only for a configured canonical RP.
Enterprise-bound local passkey use is withheld pending its qualified policy owner.

The full built browser passes real TOTP/passkey lifecycles, both signed UV=false
refusals/replays, and actual database failure after verified key insertion but
before replacement-session creation. The original key/user/session mutation
rolls back and the consumed nonce remains gone. Native HTTP, direct SDK and
lower-router errors now omit credential/ceremony payloads; missing session lookup
knowledge is503, not an anonymous identity. Exact checkpoint:
`doc/operations/aw-v10-evidence/native-passkeys-2026-10-24/checkpoint.json`.

Next: propagate actual current actor/session proof into every configured-operator
owner's effect transaction. Enterprise SSO/recovery, other sensitive actions,
auth security audit completion, physical/deployed qualification, original payload
source privacy/typed origins/portability regressions and the rest of V10 remain
open. This is no PR-ready or release-admission claim.

### 2026-10-24 — native operator proof at original domain admission

Configured operators now require actual verified native passkey-session proof in
enterprise qualification, execution sandbox configuration, SaaS instance settings
and native support request transactions. Existing tenant permissions, scoped
owner approvals and resource/version fences remain. Support approval expiry uses
database time; proof and scope checks repeat before commit. Structural native
proof fixtures and an actual PostgreSQL wait/revocation race qualify bounded
domain behavior, separately from the real WebAuthn browser checkpoint.
Evidence: `doc/operations/aw-v10-evidence/native-operator-admission-2026-10-24/checkpoint.json`.
Async host dispatch/completion, process-local drain application after audit commit,
remaining operator owners and bootstrap/break-glass remain open. CE-03/V10-166,
original privacy/typed-origin/portability failures and full V10/PR gates are not
closed by this increment.

### 2026-10-24 — feedback/retention and package native operator checks

Feedback private reads/audits now share native operator-proof transactions;
triage, retention changes and new erasure commands require recent passkey proof.
Package publication/revocation use the original transactions and repeat actual
proof before commit. Historical restore fixtures keep old-schema SQL guards
rather than invoking modern auth services before their schema exists. Full native
feedback/image/retention/restore suites pass73. The broad package Context/Memory
failures remain open and representative old-owner controls reproduce them;
manifest/source admission is not relaxed. Detailed bounded evidence:
`doc/operations/aw-v10-evidence/native-operator-feedback-2026-10-24/checkpoint.json`.

### 2026-10-24 — internal SaaS HTTP and private metadata admission

The complete internal human HTTP namespace now requires verified current native
operator passkey proof, recent for mutations. Operations/fleet/inventory/cost
snapshots hold that proof across their original reads in actual transactions;
scoped support keeps its original approval owner. Native HTTP/domain suites pass41
with weak/missing/Board-key/stale/deleted proof cases and unchanged tenant/account
flows. Evidence:
`doc/operations/aw-v10-evidence/native-operator-http-2026-10-24/checkpoint.json`.
Catalog/fleet/cost effect transactions, async dispatch/reconciliation, original
source failures and complete V10/PR admission remain open.

### 2026-10-24 — catalog and cost-report native operator transactions

Runtime catalog/capacity/status and cost reports now retain the actual actor and
repeat native recent-passkey proof in their original write transactions, including
idempotent return paths. Original qualification, restore, coverage, estimate and
audit owners remain intact. Evidence:
`doc/operations/aw-v10-evidence/native-operator-catalog-costs-2026-10-24/checkpoint.json`.
Fleet human requests and original async/source/V10 admission work remain open.

### 2026-10-24 — fleet human proof and original scheduler authority

Fleet human creation/drain/fence/retire requests retain actual actors and repeat
recent native passkey proof inside their original transactions. Exact existing
scheduler calls remain distinct from user-ID data, with original cost ceilings
and provider outcome reconciliation preserved. Native suites pass14; this is
software/provider-fixture evidence, not a live host or dispatch qualification.
Evidence: `doc/operations/aw-v10-evidence/native-operator-fleet-2026-10-24/checkpoint.json`.
Complete operation provenance and the remaining V10/PR gates stay open.

### 2026-10-24 — native sandbox command queue proof

The original native sandbox host-command bridge now requires current/recent
operator proof according to the actual action, pins it across queue admission and
rechecks successful private receipt presentation. SaaS wiring passes the canonical
operator list; no configuration fails closed. Original encrypted host scope,
signature, lease, epoch and outcome checks remain. Native suites pass32 and server
compilation passes; physical dispatch/host qualification stays open. Evidence:
`doc/operations/aw-v10-evidence/native-operator-host-queue-2026-10-24/checkpoint.json`.
Powerful credential/enterprise/input-source and complete V10/PR work remain open.


### 2026-10-24 — native powerful credential issuance and explicit CLI consent

Original Board/CLI creation and replay now require actual recent native human
proof in their physical transactions, with verified-email/passkey requirements
for configured operators. Native password confirmation returns the actual
replacement session; the reused confirmation UI checks it against the canonical
session before acknowledgement. CLI approval follows a fresh review and a
separate explicit click, with expected-user/session headers checked server-side.

The CLI no longer mints another Board key from an approved bearer. Its existing
browser challenge retains the exact requested key label/lifetime (migration0524),
shows these before consent and returns metadata for that exact approved key.
A controlled same-session refresh initially reproduced lost confirmation guidance;
the selection-bound guidance correction preserves all effect/session fences.
Evidence: `doc/operations/aw-v10-evidence/native-powerful-credentials-2026-10-24/checkpoint.json`.
Enterprise/recovery/remaining sensitive actions, original source/typed-origin/
portability/input-receipt failures and full V10/PR admission remain open.

The final native checkpoint passes84 backend cases in four suites,84 client
cases in six suites, server/UI/CLI compilation and token gates. The real built
Chromium lifecycle passes after all three controlled race regressions first
failed and were corrected. The ceremony remains mounted but hidden through its
own session recheck; acknowledgement is bound to the verifier's actual SID.
Challenge reads detach from an older account's in-flight HTTP request. Software
virtual-authenticator/fixture evidence does not qualify enterprise recovery,
physical hosts/keys, mixed-version deployment or complete V10/PR admission.


### 2026-10-24 — actual model-turn selection and dispatch intention

A new awaited boundary observes the exact finalized backend turn input after
resumption/recovery selection. Its production callback records only bounded
hash/length/continuation facts on the original run, fenced by real launch event,
coordinator lease, attempt and current run. Returned persistence is checked and
private SQL diagnostics are withheld. Actual PG regressions reproduced and then
closed transaction-time lease revival, private error leakage and suppressed writes.
Final evidence:10 native database cases,471 executor mock cases,142 runner mock
cases, runner TypeScript build and server compilation. Original source regressions
still reproduce3 failures with the retained private-body control passing. Complete
input receipts/constructors, typed origins, cross-owner reads and full V10/PR gates
remain open. Evidence:
`doc/operations/aw-v10-evidence/native-model-dispatch-2026-10-24/checkpoint.json`.

### 2026-10-24 — first direct Human Task source constructor

Only a narrow independent manual Task created through a current native Board
session now binds its actual stored body and actual Human audit atomically.
Session/User/membership pins, canonical mutation policy and final database-clock
expiry checks protect admission; failed audit storage rolls the Task back.
Historical attribution/dedup/derived inputs stay unknown. Actual operational
updates preserve the binding while body changes invalidate it irreversibly.
Original create/dedup/update responses strip private fields with the shared
public projection; the first built browser check reproduced the create leak
before that fix. Final native owner/public-projection checks pass19 cases in two
suites, and the real built cookie-session/authenticator browser passes. Three
additional legacy route failures reproduce against the parent production files
and remain open. This first producer does not activate Native run protocols,
complete payload reads, other constructors or full V10/PR admission. Evidence:
`doc/operations/aw-v10-evidence/native-manual-task-2026-10-24/checkpoint.json`.

### 2026-10-24 — consistent run identity at direct and recursive read owners

The common SQL Task-source graph now validates the actual run's unique UUID
binding for both direct run reads and recursive list/count/read projections.
Conflicting references and Task-key-only unknown history are denied; equivalent
UUID spellings remain valid. A parent-production control first reproduced the
ambiguous-run exposure. The two broader route fixtures now use actual native
Project HTTP creation and explicit valid Task bindings, retaining separate
negative ambiguous/unknown rows. Final124 cases across five native suites pass.

The corrected typed-origin fixture records three genuine open failures: valid
Workflow/Routine origins are wrongly looked up as heartbeat runs, and a same-ID
unrelated heartbeat can substitute for a missing WorkflowRun. Combined with the
unchanged private-Memory/temporal cases, the focused remaining source gate is
six failures/five passes in three suites. This checkpoint does not admit private
work, complete input receipts, typed origins or full V10/PR acceptance. Evidence:
`doc/operations/aw-v10-evidence/native-run-binding-2026-10-24/checkpoint.json`.

### 2026-10-24 — protected authentication effect deadlines

A native real-crypto password-change request first reproduced a stale-MFA
effect: its proof was current at admission, expired during an observed actual
credential UPDATE lock wait, yet the original handler committed successfully.
The shared native proof now carries its actual source-session expiry. Protected
password/factor/passkey owners check that original expiry and original recent
authentication event against database wall time after their effects, before
commit. Session rotation or intentional revocation cannot renew the source's
authority; principal/generation/credential/factor verification still belongs to
the original pinned transaction. New authentication ceremonies keep their
existing separate verifier semantics.

Final48 native cases in three suites pass. Four real lock-wait controls cover
MFA and session expiry during password change, recovery-code rotation and MFA
disable, preserving credential/factor bytes, original proof time/expiry, User
generation and the exact incoming session cookie on rejection. Expired session
lookup uses the maintained native `200/null` contract; standard refresh/cache
query controls prevent the fixture from silently renewing its test deadline.
Initial failed fixture expectations are retained as such. Remaining typed and
private-source/temporal failures, complete Native input receipts, enterprise
recovery/remaining sensitive actions and full V10/PR admission remain open.
Evidence:
`doc/operations/aw-v10-evidence/native-protected-auth-deadlines-2026-10-24/checkpoint.json`.

### 2026-10-24 — direct Human Project capture and successful replay checks

An independent open Project created through the original HTTP owner now binds
its direct Human body on the same pinned native transaction as its actual Human
capture audit. Related/generated/workspace/environment/policy inputs, service
attribution, Board keys, missing sessions and old receipts remain unknown. The
small stored-body SQL expression and final session check are shared with Task.
Existing operational updates preserve proof; changed body fields invalidate it.

Actual lock waits additionally reproduced expired member-session and stale
operator-proof Task dedup success. All Task successful returns now share the
final deadline guard; Project replay also checks operator recency. Current32
owner/public cases and two isolated replay controls pass. The earlier59-case
body-binding check remains bounded to its source stage; an intervening DB setup
timeout/exit130 is preserved as interrupted, without counting skipped cases.
The built real cookie/authenticator browser checks both Source bindings/audits.
Evidence:
`doc/operations/aw-v10-evidence/native-manual-project-2026-10-24/checkpoint.json`.
All six typed/private source/temporal failures, other producers/mutations,
complete Native input receipts/read lifetimes and full V10/PR gates remain open.

### 2026-10-24 — retain native package activation custody

A real package installation and a different currently authorized administrator
reproduced substitution of the original installer's identity at the readiness
boundary. That synthetic actor also discarded the incoming session/source facts.
The existing native authority hash and execution SQL require the assessment's
principal to match the retained installer. Changing the assessment owner alone
would therefore report activation without satisfying its native execution gate.

The shared review now requires that original accountable Human and passes the
actual actor to readiness. Other authorized administrators retain suspension and
uninstall; no ownership transfer is inferred or introduced. The readiness owner
uses the existing AuthorizationActor type, preserving nullable native identity
fields without coercing an authentication source to a session.

The focused four-case native gate passes. Its new boundary control deliberately
intercepts readiness and throws before assessment/admission: it proves identity
transport, rejection before borrowed authority, rollback and the independent
stop/uninstall paths, not successful Context/readiness or source qualification.
The pre-run Context/accountable-run failure, historical assessment source-read
checks and runtime source-currentness remain open. Evidence:
`doc/operations/aw-v10-evidence/native-package-review-custody-2026-10-24/checkpoint.json`.
Full V10/PR acceptance is still open.

### 2026-10-24 — direct Human comment source and native event owner

The original ordinary comment owner now captures independent direct Human
input using its actual pinned native actor, same-transaction body binding and
source audit, and final source deadlines on both new input and old replay.
Historical protocol0 and unknown protocol1 comments remain unknown; service
attribution and structured/attachment/specialized inputs supply no capture.
The audit uses the native parent Task entity and exact comment detail so its
actual live event follows existing current Task source authorization.

Final9 native comment checks, final built cookie/authenticator browser and
server compilation pass. Six public DTO checks also pass in a gate whose
separate initial private-event fixture expected HTTP201 incorrectly: the
original private-work guard correctly returned422 and remains closed. The
corrected native-domain event control proves owner delivery/other-member
exclusion without qualifying private HTTP work. Earlier26 Task/Project owner
cases pass after the shared SQL change; failed metadata fixtures and their
source-stage limits are retained.

Company HTTP activity/audit source-aware pre-limit reads and lifetimes remain
open, along with the six typed/private source/temporal failures, other producers
and complete Native input receipts. This is no full V10/PR admission. Evidence:
`doc/operations/aw-v10-evidence/native-manual-comment-2026-10-24/checkpoint.json`.

### 2026-10-24 — native activity privacy before pagination/export

Three actual current-member HTTP controls reproduced private Task metadata
exposure in company activity, unified audit and CSV. A shared native source
SQL predicate now narrows the base row queries before limits, audit cursors
and enrichment; CSV uses the same authorized pages. Actual Task, Project,
comment/document Task owner and run references resolve in their own company,
including an independent activity run ID. The direct run reader and new SQL
projection reuse the same original persisted-binding graph.

Final10 native controls, ten existing activity-route controls, nineteen existing
service/audit controls and server compilation pass across the recorded stages.
The four initial route failures were exact mock arguments missing the actual
reader, not permission/response changes; the native three-case RED is retained.
The final source test also rejects a query-supplied reader and malformed, missing
or foreign native owners without consuming the next authorized row.

This does not close other activity families, per-resource agent scopes, physical
source/auth lifetimes through enrichment/export, issue-specific projections,
the six typed/private-Memory/temporal cases or complete run receipts. No full
V10/PR admission is claimed. Evidence:
`doc/operations/aw-v10-evidence/native-activity-source-privacy-2026-10-24/checkpoint.json`.

### 2026-10-24 — fresh direct Human document revision sources

The original HTTP document owner now passes its actual native actor for fresh
literal-user input. Its transaction pins User/session/current write membership
(or recent native operator proof) before privacy/Task locks, checks current
canonical Task mutation/source privacy, creates the original document/revision
and link, then binds final stored bytes with the actual unique Task link as a
policy anchor. The Human source audit commits with those rows and notifies
through the native parent Task after commit. Final source deadlines cover waits
and effects. No new public fields or schema/dependency were introduced.

Nine native document controls,33 cases across four relevant suites, the extended
built cookie/authenticator browser and server compilation pass. Edits, imports,
restoration, attribution and locked copies remain unknown; old known revision
proof is preserved rather than transferred to a new version. This is another
input-owner building block, not a complete run receipt/private-work/PR gate.
The six typed/private-Memory/temporal cases and remaining read lifetimes persist.
Evidence: `doc/operations/aw-v10-evidence/native-manual-document-2026-10-24/checkpoint.json`.

### 2026-10-24 — original literal Human attachment upload

The original multipart route now carries its actual bytes and Board/session
actor into the existing attachment owner. Byte length and SHA-256 must match
storage metadata. The transaction pins native User/session/current write
membership or recent native passkey operator proof before privacy/Task locks,
then requires current canonical Task mutation and privacy access. Original
credential expiry and operator recency are checked after waits and effects.

Only that direct producer chooses protocol1 on its fresh attachment INSERT.
The final stored attachment/asset body is bound in the same transaction with
the parent Task policy anchor and actual Human audit. Notifications follow
commit. Existing asset/body/link invalidation remains authoritative. Public
DTOs omit private proof. Attribution, Agent/model writes and historical rows
remain unknown. Storage still precedes registration; existing known4xx cleanup
and ambiguous-failure retention do not qualify a durable upload intent.

All80 cases across four relevant suites, the extended built cookie/authenticator
browser and server compilation pass. Four initial legacy route failures also
reproduce against parent production; isolated fixture setup/mocks were repaired
without changing production permission or response requirements. Failed stages
are retained. The six typed/private-Memory/temporal cases, complete run receipts
and broader read-lifetime/V10/PR gates remain open. Evidence:
`doc/operations/aw-v10-evidence/native-manual-upload-2026-10-24/checkpoint.json`.

### 2026-10-24 — original document tool-result source capture

The actual `read_document` tool now forwards the original getter's exact
revision/issue/body hash and nullable source snapshot. Per-call state prevents
concurrent reads mixing sources. Its callback runs after orchestration succeeds
and before the result returns, and includes a digest of the selected structured
JSON. The original runnerd epoch binds the callback to its current run/launch;
current analytical access surrounds owned coordinator/run/launch persistence.
The bounded append includes the actual capture-time nullable Human. It checks
the exact returned write and the lease again; a failed/suppressed write prevents
return of the document. No raw document body or complete receipt is stored.

A parent-production control also exposed three native Task update callers that
lost their actual run ID. They now pass the original binding so the existing
canonical mutation guard can resolve the responsible Human. Current membership
and permissions remain required. Native fixtures were repaired with real users,
memberships and responsible runs, preserving all negative assertions.

All543 distinct cases across the four relevant suites pass in the recorded final
stages, as does server compilation. Earlier fixture failures and the genuine
parent regression are retained. This runtime-only change adds no UI, dependency
or migration and does not activate run protocol1, complete source receipts or
private work. The six typed/private-Memory/temporal cases and other read/action
and lifetime closures remain open. Evidence:
`doc/operations/aw-v10-evidence/native-document-tool-source-2026-10-24/checkpoint.json`.

### 2026-10-24 — native child and search Task privacy narrowing

Two actual native counterexamples reproduce private Task disclosure from
`search_tasks` and private children displacing older public children in
`get_task_context`. Both original queries now use the existing canonical Task
privacy SQL with the bound run/Agent and current DB responsible Human. Filtering
precedes the child limit/truncation and the search text/result selection.

The original two cases fail. The28-case native/existing authority suites pass
after the fix; final three native controls also verify real explicit sharing
and subsequent revocation through both tools, with public/owner controls and
102 denied children. Server compilation passes. No new grant, schema or public
DTO was introduced. This is privacy narrowing, not full action/lifetime closure.

Other projection fields remain separate: the shared child review-outcome helper
still needs source privacy at both tool and continuation callers. The six
typed/private-Memory/temporal cases, complete run receipts and full V10/PR gates
remain open. Evidence:
`doc/operations/aw-v10-evidence/native-tool-task-privacy-2026-10-24/checkpoint.json`.

### 2026-10-24 — shared child review-outcome privacy

Original PostgreSQL counterexamples reproduce private child review identity
disclosure through both native tool and continuation callers. The shared owner
now applies canonical child/source-run/reviewer-run privacy before its50-row
limit and checks corresponding company/Task/Agent bindings. The tool supplies
its actual bound reader. Continuation uses only an actual matching readable
running receiver from the server-supplied run ID and its current DB Human;
preflight/missing identity remains public-only. Context claims and saved owners
never supply private authority. No fake run or new grant was introduced.

Final56 cases across three relevant suites and server compilation pass. Native
controls include real sharing/revocation, forged no-run context hints, wrong
reviewer Task and wrong source Agent. Fixture payload type failure is retained
and corrected to the existing version1/prompt contract. These are native
consumer projection fixtures, not provider/result/input-completeness evidence.

Broader tests reproduce five older failures against parent production: one
immutable nativeIssueId fixture edit, two interaction updates missing actual
run/Human context, and two blocking-intent fixtures with no actual operator
account/membership. All five remain explicit next work. The six typed/private-
Memory/temporal cases, source/action/erasure/lifetime and full V10/PR gates remain
open. Evidence:
`doc/operations/aw-v10-evidence/native-child-review-privacy-2026-10-24/checkpoint.json`.

### 2026-10-24 — preserve authenticated identity through review Task changes

All four original review accept/reject Task mutations now preserve the actual
run ID and, for authenticated HTTP calls, the original private actor context.
A real PostgreSQL counterexample removes the authenticated Human membership
and changes the stored reviewer run to another active Human: dropping only
the actor forwarding incorrectly completes the Task, while the fix rejects403
and preserves the pending interaction and Task. Saved run ownership cannot
replace the original caller's current authority. The actor context is never a
request-body field, persisted interaction field or returned DTO.

The five native baseline failures from the previous checkpoint are resolved:
reviewer/recovery fixtures own actual Users and active memberships, and the
DB-immutable nativeIssueId mutation is asserted as a rejection with unchanged
binding. Native74 cases pass across ControlPlanePort and safe replacement;
the later original-actor regression also passes all15 ControlPlanePort cases.
Interaction/resolver units pass30 selected cases. Legacy route mocks now expose
the existing canonical open-Task query and keep custom Task rows stable across
admission/resolution reads; negative creator/review-policy checks are retained.
The failed intermediate and parent-control logs remain in the evidence.

Generic Task credential expiry/revocation during physical row waits remains
separate next work. Six typed/private-Memory/temporal source regressions,
complete-input receipts, broader V10 implementation and full PR acceptance
remain open. Evidence:
`doc/operations/aw-v10-evidence/native-review-accountability-2026-10-24/checkpoint.json`.

Final full interaction route suite:82/82 pass.
Server compilation passes for the final review actor forwarding and tests.

### 2026-10-24 — generic Task credentials across native row waits

Actual PostgreSQL counterexamples reproduce three unauthorized Task commits:
session expiry during a held Task row, Board key revocation during that wait,
and expiry during a held issue_labels DELETE after the Task write. The shared
Task updater now reuses the native Board credential pinner after the row wait
and checks the original earliest expiry against the database clock after its
child-row effects. Pending account erasure also rejects that final boundary.
Existing canonical action and source privacy decisions remain authoritative.

The existing NOWAIT credential pins prevent reversing account-erasure lock
ordering. A further held-session-row counterexample reproduced raw55P03;
the Task caller now reuses the existing authentication-state classifier and
409 authentication_state_busy response. Finite original AgentJWT deadlines
also reach the final check. Real locally signed/verified JWT positive/expiry
cases use an actual accountable running run and assignee Agent. Session renewal
during an observed wait cannot extend the original authenticated deadline.

Initial four focused cases and the expanded93 cases across five native suites
pass. The final seven focused cases pass after the additional busy-response
counterexample. Board session/key fixtures are post-authentication carriers;
Agent tests exercise the actual local JWT helper. Neither supplies provider
execution, complete inputs, current Agent-key pinning or later outer-transaction
effect/commit qualification. Broader V10/source/privacy/lifetime and PR gates
remain open. Evidence:
`doc/operations/aw-v10-evidence/generic-task-credential-lifetime-2026-10-24/checkpoint.json`.

Server compilation and the built native cookie/authenticator browser pass.
The browser includes a real authenticated Task PATCH and verifies unchanged
source hashes/audits afterward; its virtual authenticator is no hardware proof.

### 2026-10-24 — Routine retained source identity and revision immutability

Parent PostgreSQL counterexamples allow cross-company/wrong-parent Routine run
bindings and revision body edits. The real service runRoutine control and the
three existing typed Task tests also reproduce the separate known Task-origin
failure. A further real conversation-authoring regression reproduces a source
reclassification bypass: changing conversation_draft to manual skips the
existing private reader/erasure boundary. No legitimate native writer changes
those origin fields after creation.

Generated custom migration0525 validates same-company Routine/revision parents
and snapshot owner on INSERT, preserves immutable origin/run/revision identity
and revision bodies, and permits only actual FK deletion nulling or the exact
existing source-erasure projection. Existing history is neither repaired nor
upgraded into qualified inputs. All24 native conversation-authoring/erasure
cases pass, including the new origin bypass rejection. Run/revision wrong-owner
and body-edit probes pass. All actual revision/run/Agent FK nulling controls also
pass; the added direct company deletion fixture was corrected to use the
original companyService.remove dependency owner.

The existing legacy-format compatibility fixture initially edited a retained
revision. It now constructs historical bytes on INSERT and retains the actual
restore/default checks. The actual runRoutine lifecycle assertion remains
unchanged and failing on the separately reproduced typed Task-origin baseline;
it is not skipped, relabelled as provider success or hidden behind a substitute
heartbeat. Typed Task/private-Memory/temporal sources, complete inputs and full
V10/PR gates remain open. Evidence:
`doc/operations/aw-v10-evidence/routine-source-identity-2026-10-24/checkpoint.json`.

Final selected5 identity/deletion/legacy compatibility cases and server
compilation pass. The real typed-origin lifecycle baseline remains open.

### 2026-10-24 — Recover after executor replacement

The replacement executor contained the older V5 checkout, without the V10 worktree or its uncommitted typed-origin / Routine assignment changes. Re-fetched `codex/blentera-v10` at `2f221c4f5ccc1ffb1b637016ab0436590ac632fe` from GitHub into a new worktree. All committed V10 work is retained remotely. The final uncommitted slice and its local logs must be reconstructed and rerun; prior 74/74 Routine results describe the lost working tree and do not qualify this reconstructed tree. Small recovery commits are pushed as work proceeds. No merge, deployment, or PR-ready claim.

### 2026-10-24 — Reconstructed typed Task origins and durable Routine assignment

Generated migration0526 preserves native WorkflowRun/RoutineRun namespaces and every historical source edge. The original Task constructor validates the same-company retained execution revision and its actual Project/parent roots. Manual/public typed sources work; private authored sources remain denied until the native private graph is implemented.

Routine dispatch now creates its Task inside the original run transaction and nested savepoint, commits the linked received intent, and calls the native assignment owner afterward. Queue uncertainty preserves the Task. A stable native receipt key, exact receipt tuple, try-advisory lock held across queueing, received/link conditional finalization, pending coalescing and bounded scheduler recovery protect retry behavior.

Current reconstructed tests: 88/88 across three native suites, plus three scheduler/receipt/concurrency checks. The four private typed source tests retain two real owner-positive failures and two controls passing. Native SDK/runner prerequisites are rebuilt; final and expanded server typechecks pass. The missing-prerequisite attempts and initial four fixture failures are archived separately. Actual clock, original source capture and immutable revision guards were preserved; source receipt flags were not fabricated. Evidence: `doc/operations/aw-v10-evidence/typed-task-routine-recovery-2026-10-24/checkpoint.json`. These software queue fixtures do not qualify a physical process restart, provider execution, complete model inputs, full private/temporal source graph or PR readiness.

### 2026-10-24 — Preserve unknown import effects before another apply

Actual PostgreSQL counterexamples reproduced the existing startup transfer recovery changing an uncertain non-idempotent `applying` run into retryable `failed`. The native transfer owner now preserves `needs_reconciliation`, returns the same run on same-content declaration and refuses new effects. Known pre-dispatch refusals retain their original retry path. A domain exception or failure to save the uncertainty state cannot release the old apply claim. The existing async projection and Import UI show unknown outcome, retain the original stored job, prevent activation/resubmit and refuse unrelated-job adoption on the controlled409.

Expanded tests65/65 across service, route and UI; overlapping late generic writer checks10/10; adjacent cloud/portability routes52/52. Server/UI typechecks and token gates pass. Actual PG/fresh-connection scenarios and structural importer callbacks do not qualify physical process death, a complete real import, full CustomerOperation persistence, native effect checkpoint/mapping or automatic reconciliation. The process-local async job Map remains the next mandatory native owner migration. All failures and limits: `doc/operations/aw-v10-evidence/import-unknown-outcome-2026-10-24/checkpoint.json`.

Follow-up: normally journaled custom data migration0527 conservatively marks pre-existing failed import transfers as needs_reconciliation. Old failure labels cannot establish non-application. Native11/11 history tests and DB migration/build checks pass, including applying the actual migration twice without reopening work and an export control. This adds no column or second executor; full durable job migration remains open.


### 2026-10-24 — Durable native import identity and process-loss receipt

The original CompanyImport routes now retain admission/status in native PostgreSQL customer_operations rather than a process-memory job Map. Original portability owns effects. A scoped canonical request fingerprint, locked requester, native attempt nonce/counter and guarded settlement preserve one logical operation; unknown effects cannot be retried. Original verified session/key deadlines and current native access are pinned at admission/start. Known pre-domain retry remains fenced and respects another active job. UI retains the original unknown receipt through missing status and cannot resubmit automatically. Optional full-result cache is no longer status authority.

Final bounded ten-suite run183PASS; overlapping final six-case service run6PASS. A physical child SIGKILL follows a real native Agent-only import against actual PostgreSQL, before receipt settlement; restart retains unknown state and the single persisted Agent. Server/UI compilers and token gates pass at recorded checkpoints. Intermediate failures and exact source pins: `doc/operations/aw-v10-evidence/durable-import-2026-10-24/checkpoint.json`.

This supersedes the earlier process-memory Map limitation. Source-byte/preview binding, per-effect mappings/checkpoints, all-effect current-authority checks, cancellation, authoritative reconciliation, safe resume and full retention lifecycle remain open. These tests do not qualify a hosted/provider import, complete CE-08/V10 or PR readiness.


### 2026-10-24 — Bind Import to reviewed source files

The native preview fingerprints its canonical resolved file map; the Import page passes that expected value for GitHub, ZIP and chunked inputs. The original owner rejects changed source before effects with a typed native proof; the original route records a known rejection and offers fresh preview rather than an unknown or a replay. Ordinary post-invocation exceptions remain unknown. Original actual import/SIGKILL and route/transfer/UI controls plus changed remote-file-map regression103PASS5suites. Full workspace typecheck returned0 at the recorded checkpoint, before later Help/continuity completion. All logs/source pins: `doc/operations/aw-v10-evidence/import-preview-binding-2026-10-24/checkpoint.json`.

This is source-file consistency, not complete preview-plan/selection confirmation or source permission. Legacy callers may omit the fingerprint; immutable remote commit identity, native per-effect mappings/checkpoints, full current-authority, cancellation/reconciliation and final V10/workspace qualification stay open.


### 2026-10-24 — Responsibility continuity without delaying revocation

Native member archive now explicitly transfers eligible manual routine responsibility using the original retained-revision writer, or pauses active owned work without waiting for a replacement. Private conversation source ownership remains unchanged. Suspension/pending, combined grant withdrawal and instance company-access removal share the native pause behavior. Current managers receive a generic source-safe Action-needed projection for unresolved routine ownership. Original dispatch and fresh pending assignment retry also require the actual current responsible account/member; User-before-member NOWAIT returns a safe busy409 rather than waiting on revocation. Actual resolved local mode is wired from server configuration. Accepted native wake receipts may settle a known result.

Final access/attention25PASS; original routine77PASS; original experience24PASS after an actual User/HTTP Project constructor corrected the archived-project race fixture. Intermediate failed fixtures/checks retained with exact source pins in `doc/operations/aw-v10-evidence/owner-continuity-2026-10-24/checkpoint.json`. Provider stops, full credentials/inventory/coverage/groups/contact handoff, current eligibility for all objects and V10 acceptance remain open.

### 2026-10-24 — Help, retained Work and discoverable import receipts

The shell Help entries open a dedicated Help destination, configured docs/status/Human contacts, original cases and original-requester import history. A single native dialog retains the originating Work and support draft while releasing modality on close; state is scoped to actual company/User/session. App16PASS and history3PASS. Bounded native company history rechecks credential/company authority and preserves PostgreSQL microsecond cursor precision; actualPG/HTTP1PASS. New-company pending/unknown operations without a companyId remain outside this company list. Help reuses Mintlify with Blentera navigation and two metadata-bearing articles, not a second CMS or an invented delivery/approval fact.

Exact sources, intermediate failures and current limits: `doc/operations/aw-v10-evidence/help-import-history-2026-10-24/checkpoint.json`. Stable full workspace/build and actual built cookie-auth/browser follow-up are running separately. Complete Help IA/search/grounded assistant, all metadata/link freshness, source privacy, full operations lifecycle and full V10/PR gates stay open.


Follow-up verification: full workspace typecheck0 and build0 at the recorded source checkpoint. Actual production UI/native cookie/PG/Chromium journey1PASS35.1s confirms native modal keyboard confinement, exact Help focus, same Work heading, original support draft and both request-interruption recovery phases. The initial hidden-H2/H1 selector failure is retained; corrected selector and subsequent explicit Ask Blentera branding check pass. Help docs restricted-frontmatter/local-link CI is wired into trusted PR verification; Node5PASS and current article validation0. No new dependencies or automatic approval/expiry policy. See the Help/history checkpoint followUp and source pins. Full test:run, physical distributed/provider, manual accessibility, complete source privacy and V10 release/PR gates remain open.

### 2026-10-24 — Retained Help search, native creator credentials and unbound import discovery

The original Help dialog now queries the existing company Find Help projection in place, with current account/session/route fencing and native documentation links. Actual cookie-authenticated production UI/PostgreSQL/Chromium journey passes, including original Work retention, keyboard focus and request recovery. The linked Help change review gate hashes both source and article bytes, accepts additional linked articles and preserves explicit review evidence; the existing two articles are not the complete V10 Help inventory.

Original Task constructors, recovery, watchdog and comment approval paths retain the verified request actor rather than reconstructing credentials from display IDs. Native source/credential regression suites60PASS, expanded credential lifetime9PASS and Task interaction70PASS are separate scoped receipts. They do not prove complete source inputs or full private/temporal provenance. A real no-expiry Board key succeeds; a session that expires during an observed company-counter wait rolls creation back.

The original import history owner now includes the same named requester's running/unknown new-company operation before its target is confirmed. The DTO explicitly reports an unconfirmed target and suppresses inferred results. Other users, malformed existing-target receipts and another company's confirmed operations remain excluded. Native/UI follow-up6PASS, server/UI compilation and token/Help checks pass at their recorded source checkpoints. Evidence: `doc/operations/aw-v10-evidence/native-actor-import-followup-2026-10-24/receipts.json`.

Recovered uncommitted company search transaction work was saved and pushed as42f94c804 before further edits. Its native lifetime tests are in progress. The actual private Memory derivative leak was reproduced and archived before mitigation. Full workspace tests, current all-source privacy, temporal provenance, complete import lifecycle, Help/Support coverage and V10 acceptance remain open; no merge, deployment or PR-ready claim.

### 2026-10-24 — Deny selected private Memory leakage through Task derivatives

The shared native Task source SQL now applies a necessary negative ownership fence to actual Memory roots selected by a visited producer Run. Missing native roots, missing required private owner, another Human's private owner and another Agent's private scope deny the derivative before limits/counts/results. Existing positive policy, graph cycle checks and exact native Run binding remain required. The original producer Task remains public; the source owner can still read and search the derivative. No Source receipt/qualification flag or complete-Memory authority is fabricated.

Actual native leak regression plus manual Task payload controls14PASS. The test additionally checks that actual owner search returns the secret-bearing Task; its search term is a public prefix so an echoed caller query cannot be mistaken for leaked content. Earlier failed and mixed temporal runs are preserved. The two existing earlier-payload temporal failures remain open, as do transitive Memory/Foundation/lifecycle closure, exact body snapshots and complete source input qualification. Evidence: `doc/operations/aw-v10-evidence/private-memory-derivative-2026-10-24/receipts.json`.

### 2026-10-24 — Native company search transaction and original deadline

Company Find and extraction now run their existing services and pre-limit privacy SQL on one native transaction. A separate narrow company-read callback reuses the original authorization owner and principal/credential/role/grant pins; it cannot grant Task/Project row reads or escape its callback lifetime. Final PostgreSQL clock/current-account-deletion checks enforce the original verified credential deadline, including when the stored session deadline is later. Existing Task-source callback action admission remains unchanged.

Four native/search/route suites49PASS at the saved checkpoint; original search-owner server compilation passes. Native actual service tests return real result rows for current sessions and return403 without results after expiry during a delayed database read. Further Memory erasure control1PASS: the existing native deletion owner already withdraws the derivative while retaining the original public Task, so no duplicate erasure mechanism was added. Evidence: `doc/operations/aw-v10-evidence/company-search-native-transaction-2026-10-24/receipts.json`. Other read families, canonical complete source provenance, full workspace and V10/PR gates remain open.

### 2026-10-24 — Immutable GitHub import snapshot

The original portability resolver checks repository availability and resolves the requested ref to an actual full commit/tree identity before any package body. The complete, nontruncated recursive tree must match that identity. Package files, explicit includes and logo use the same commit SHA; relevant unsupported submodules fail closed. Only main-ref404 permits a master fallback. The preview exposes the actual SHA in EN/DA and its existing fingerprint includes GitHub commit identity as well as normalized bytes. Inline fingerprint compatibility remains unchanged.

Native importer/structural transport regressions11PASS and Import UI29PASS, server/UI compilation and token gates pass. Original changed-byte coverage remains alongside unchanged-byte branch movement, invalid/missing/mismatched identities, tree failures and missing COMPANY.md fallback controls. Evidence: `doc/operations/aw-v10-evidence/github-import-commit-2026-10-24/receipts.json`. This is coherent source resolution and preview consistency, not source permission or real GitHub qualification. All-effect authority, mappings/checkpoints, cancellation/reconciliation, retention and complete CE-08/V10 acceptance remain open.

### 2026-10-24 — Preserve the verified workspace recovery actor

The native workspace branch-reconcile route now passes its original verified HTTP actor through to the original Task update used by quarantine restoration. Display/audit IDs cannot recreate a credential. Native local-trusted service fixtures explicitly retain that actual mode, and Task mutation fixtures create Projects through the canonical HTTP constructor instead of treating raw historical Project rows as known Sources. Current Task authority denials, source graph and approval/review transitions remain intact.

Full two-suite workspace service/route run78PASS and server compiler0. Actual temporary Git/worktrees exercise dirty rescue, pending execution-review/approval semantics, reaping and existing safety failures. Before and intermediate failures are retained. Separate current native V7 package run still has40FAIL/75PASS from actual source/Readiness admission; no fabricated accountable Run or source/Ready flag was used to hide those failures. Evidence: `doc/operations/aw-v10-evidence/workspace-recovery-2026-10-24/receipts.json`. Full workspace tests, complete source privacy and V10 release gates remain open.

### 2026-10-24 — Finish remaining non-server workspace projects

The adapter/plugin/CLI projects that the earlier UI/DB group failures prevented from running now completed with the repository's source-only `**/dist/**` exclusion. Result3187PASS/1FAIL/12SKIP across209files. The unresolved CLI company import/export fixture hits a preserved unknown-outcome refusal and is under diagnosis. The initial direct invocation accidentally included compiled test copies; that interrupted attempt remains separate evidence. No test exclusions or expected-source assertions were removed.

The run began before concurrent bounded Help/import edits and is not a stable full-current workspace receipt. Whole UI/DB repaired cases remain targeted evidence, not freshly green whole groups. Evidence: `doc/operations/aw-v10-evidence/remaining-workspaces-2026-10-24/receipts.json`.

### 2026-10-24 — Expand actual Help coverage and preserve native browser evidence

The existing Mintlify Help navigation now has the ten V10 topic groups and14 source-linked preview articles. Seven retained customer guides were revised against current screens/services and five missing guides added; existing technical references remain separate. Current source/article hashes and explicit decisions cover the linked flows. The generated Help search catalog includes the actual content. Source/code review metadata is evidence of this bounded review, not publication approval or representative Human acceptance.

Node12PASS, focused search41PASS and actual production UI/cookie-auth/PostgreSQL/Chromium journey1PASS37.7sec. The latter retains original Work, Help search, support draft, keyboard focus and before/after-acceptance recovery. Early fixed count/order expectations and stale article hashes after metadata edits are retained. Evidence: `doc/operations/aw-v10-evidence/help-ia-2026-10-24/receipts.json`. Hosted docs, complete DA articles, a grounded assistant, complete release/deprecation history, analytics, live support delivery and full V10 acceptance remain open.

### 2026-10-24 — Keep read-only import refusals out of unknown-effect recovery

The original portability owner can now issue a native preflight error only around its read-only source-admission check before any company/secret/Agent/Project/Task effect. The route records that refusal as a known failed request. Ordinary domain422 errors and other post-invocation exceptions remain unknown. The existing source-preview mismatch retains its specific proof and message.

Final native job/route47PASS, actual CLI1PASS, server compiler0; actual child SIGKILL after a real imported Agent still preserves unknown/nonreplayable state. The CLI fixture retains the original unauthorized cross-company content attempt plus no-effect assertions, exercises new-company/ZIP company+Agent configuration and restores full content inside its original company. Authorized cross-company publication remains unimplemented, rather than bypassed or claimed as tested. Evidence: `doc/operations/aw-v10-evidence/import-source-refusal-2026-10-24/receipts.json`.

### 2026-10-24 — Canonical Project admission for email fixture

The low-trust email fixture now creates its Project through the original authenticated local-trusted HTTP admission. Source defaults and actual email/provider behavior are unchanged. Focused two cases pass; complete email integration file26PASS. Native recovery already passed after the earlier actor fix. Existing fake provider transport remains a transport test, with no actual email delivery qualification. Evidence: `doc/operations/aw-v10-evidence/email-project-admission-2026-10-24/receipts.json`.

### 2026-10-24 — Prevent private input from replacing an original public Task body

An actual native counterexample showed a Run copying its selected private Memory into its original public Task. Own-Run source edges are intentionally excluded to avoid cycles; changing only the description also bypassed privacy re-resolution. The shared Task update now reuses the original native body hash and refuses changed Agent bodies when restricted Run sources cannot yet be retained. This keeps the old body. It grants no private-source publication or fabricated snapshot. Public-source body changes and private-run priority-only changes remain valid.

Focused native/credential/manual-input23PASS, server compiler0. Broader Task service138cases has18 existing admission/fixture failures before this new guard (unknown raw Projects and missing current Human); those fixtures remain under canonical-admission repair. Evidence: `doc/operations/aw-v10-evidence/private-memory-own-task-2026-10-24/receipts.json`. Exact body-bound private Agent source snapshots and owner-positive private body updates remain required; this conservative refusal does not complete that feature or V10.

### 2026-10-24 — Complete the Task service admission fixture repair

The full138-case Task service suite now passes. Workspace inheritance fixtures create their Projects through the canonical HTTP/local-trusted source owner; two attributed mutation cases use persisted verified Human accounts and active memberships. Existing inheritance, assignment, OAuth-state invalidation, terminal transition and source-denial assertions remain. The new restricted Agent-body refusal remains enabled.

This supersedes the preceding18-failure fixture checkpoint, whose log remains retained. Evidence: `doc/operations/aw-v10-evidence/task-service-admission-2026-10-24/receipts.json`. Native source/Readiness package failures, typed private sources, temporal provenance and full V10 acceptance remain open.


### 2026-10-25 — Native Help in both languages and command search

The original Help catalog now contains fourteen English and fourteen Danish source-linked preview articles, under native Mintlify language navigation. Existing English documentation URLs remain. Native company Find filters Help by the selected presentation language before counts and pagination; omitting the optional locale retains English compatibility. Help, Cmd+K and Search use locale-specific query/cache identity and withhold late results after language or authority changes. A shared checked Help decoder validates article identity, current metadata and the configured HTTPS documentation destination.

The native production UI/cookie/PostgreSQL/Chromium journey passes in both languages, including current account preference persistence, Danish Work, actual localized Help API results, new-tab navigation and original Work/focus retention. External documentation navigation uses an inert intercepted destination: this is not hosted documentation qualification. Scoped search78PASS, shared UI decoder45PASS, documentation Node14PASS, UI/server compilers and token checks pass. The current Mintlify schema validates with zero errors; source review covers28articles/166source pairs at80aa7a914. Initial failed fixture expectations remain archived. Evidence: `doc/operations/aw-v10-evidence/help-locale-2026-10-25/receipts.json`. The preceding Cmd+K journey and full workspace compiler checkpoint are retained separately in `command-help-2026-10-25`.

The Memory core fixture now persists its actual Human account and active owner membership. Its two Human controls pass; twenty-one Agent cases still lack an actual native Run/Task/Context and fail admission. No fabricated Run or source qualification was added. Evidence: `doc/operations/aw-v10-evidence/memory-core-identity-2026-10-25/receipts.json`.

All implementation changes through80aa7a914 are pushed to the V10 branch. Full native source/temporal provenance, Readiness, complete import lifecycle, support delivery and grounded assistant, broader Find and the remaining V10 acceptance contracts are open. No complete V10, full-current test pass, PR-ready, merge or deployment claim.


### 2026-10-25 — Preserve unknown support delivery after an expired lease

The original scheduled support maintenance transitions expired sending attempts to unknown while preserving attempt/provider identity. It neither sends nor automatically retries. It acquires company, case and event locks in native order, skips busy roots and uses a bounded transaction. The customer projection remains pending for an active attempt and unknown for an expired one. Paired English/Danish Help guidance explains preserving the reference and contacting support directly without duplicating an uncertain delivery.

Native authenticated HTTP/PostgreSQL suite55PASS includes two actual database connections, locked company/case skipping and transition after release, future leases, unchanged delivered/pending states and repeated maintenance. Documentation metadata/catalog checks pass. Evidence: `doc/operations/aw-v10-evidence/support-delivery-lease-2026-10-25/receipts.json`. The provider-neutral gateway, actual outbound dispatch/reconciliation, returned operator messages and provider erasure remain open; no external messages were sent.

Whole workspace build completed with exit0, beginning at1999747a0. Support/native edits overlapped that run, so the archive explicitly records that it is not a stable-source final PR receipt. The complete UI suite is running separately. Full native Source/Readiness and other V10 gates remain open.


### 2026-10-25 — Bind actual backend turn acknowledgement to its input attempt

Each original native chosen-input intent now returns a unique persisted dispatch UUID. The original runtime passes that server-held key to an optional callback only after backend startTurn returns its actual turn ID. The native writer matches UUID, launch event, attempt and exact input digest under the original coordinator/run lease. Distinct identical inputs remain distinct; backend mutation of its input object cannot change the captured acknowledgement identity. A rejected startTurn leaves the original intent unacknowledged. No raw model message is added to this fact, no old responsible Human is rewritten, and protocol/source qualification remains disabled.

Full native session runtime142PASS, actual PostgreSQL integration27PASS, focused executor2PASS/471notselected and runner build0. The initial root-workspace runtime invocation found no tests because this package uses its own Vitest configuration; its corrected full run and the original failure are both retained. Evidence: `doc/operations/aw-v10-evidence/native-turn-acknowledgement-2026-10-25/receipts.json`. The compiler after rebuilding the runner interface reports no native acknowledgement errors but one concurrent support gateway helper type error; final complete compilation remains required. Earlier stale built-interface compiler errors are not a pass. This acknowledgement is identity evidence, not delivery, complete input sources or an immutable output binding. Actual per-output input/body closure and temporal source failures remain open.


### 2026-10-25 — Native outbound support gateway and explicit relay configuration

The existing case/event owner now has a provider-neutral outbound gateway and an explicitly configured HTTPS relay, disabled by default. Startup requires an exact recipient/processing policy, fixed HTTPS URL, provider key and separate credential. The same policy parser serves intake and delivery. The native worker commits an attempt before I/O, then rechecks current users/company/case/membership/deletion/expiry under native root locks through bounded transport. Only the exact current attempt's validated provider acknowledgement records delivery. Earlier pending/sending/unknown customer events block later replies; uncertain attempts are never replayed. No privileged support session is granted. Customer guides retain truthful local receipt/unknown delivery language and reference these new original owners.

Native PostgreSQL delivery6PASS, combined original authenticated support intake/HTTP adapter58PASS, server compiler0 and Help metadata/catalog/source review172pairs pass. Earlier mid-edit stale runner-interface and gateway-helper compiler failures are archived separately from the corrected final compiler result. The native delivery fixture initially violated retention setup and contaminated later pending-case controls; the final saved run passes after correcting those fixtures. Its intermediate overwritten log is not an archived raw receipt. Current software evidence uses an injected transport; no external support messages were sent. Evidence: `doc/operations/aw-v10-evidence/support-outbound-gateway-2026-10-25/receipts.json`.

This completes the bounded outbound gateway implementation, not the full support contract. Actual provider qualification, returned operator messages, provider erasure/reconciliation, attachments/diagnostics, case-linked privileged support and the Agent Package based grounded Support Assistant remain open. Full native Source/Readiness, import lifecycle, broad Find and the other V10 acceptance gates remain open. No PR-ready, merge or deployment claim.


### 2026-10-25 — Whole UI suite and exact native tool-call identity

The complete current UI workspace suite passes8155tests across821files (1325.14seconds). UI/shared sources were unchanged throughout; bounded backend changes overlapped. This supersedes the earlier whole-UI failure checkpoint and targeted-only repair evidence. It does not imply a full server/workspace test pass. Evidence: `doc/operations/aw-v10-evidence/ui-workspace-2026-10-25/receipts.json`.

Supported native backend callbacks now retain the actual turn ID through the existing tool-authority boundary. A native association is recorded only for one validated acknowledged dispatch UUID under the original lease. Missing/ambiguous turn identity stays unknown, including callbacks racing their acknowledgement. Each (turnId,callId) tuple is idempotent only with matching dispatch/event/attempt/tool; duplicate or malformed history is not replaced. No tool arguments or content are added to this fact, and no Source protocol/qualification is enabled. Native PostgreSQL30PASS, the actual changed document callback2PASS/471notselected and server compiler0. Evidence: `doc/operations/aw-v10-evidence/native-tool-dispatch-2026-10-25/receipts.json`.

The remaining first-party account-channel notice now uses the shared Blentera product identity in English and Danish. Existing own-account channel suite11PASS, with no real external messages. Evidence: `doc/operations/aw-v10-evidence/notification-channel-brand-2026-10-25/receipts.json`. Full immutable input-to-output source closure, Readiness and other V10 gates remain open; current DB workspace checks are running separately.


### 2026-10-25 — Saved native mutation, authentication and support receipts

The full database workspace suite passes183tests/49files, with database sources unchanged during the run. Evidence: `doc/operations/aw-v10-evidence/db-workspace-2026-10-25/receipts.json`. The whole server and final workspace gates remain open.

Original native mutation receipts now retain the exact acknowledged model input dispatch when the actual backend turn/call identity is unambiguous. The receipt is committed atomically with the original Task/document mutation; replay cannot rebind it and a receipt failure rolls the effect back. Native authority33PASS. Evidence: `doc/operations/aw-v10-evidence/native-mutation-input-2026-10-25/receipts.json`. This identity fact does not establish complete immutable per-output source closure or enable Source qualification.

Shared protected authentication now retains the original request's verified credential deadline even if the stored session is subsequently extended. A native PostgreSQL red/green regression proves the expired original request rolls back while a newly verified request succeeds; the full lifetime suite14PASS. Native account/TOTP/passkey callers also preserve this deadline, with native two-factor21PASS and an actual isolated Chromium/TOTP/software-WebAuthn journey1PASS. The initial browser timeout remains retained; only test diagnostics changed, with no claimed production UI fix. These are software proofs, not physical authenticator qualification. Evidence: `protected-auth-deadline-2026-10-25` and `native-auth-carrier-2026-10-25` under the evidence directory.

Configured, recently verified Human operators can now return safe durable support replies/status changes through the original case/event owner. Current operator authentication, expiry, deletion, versioning, exact replay and publication-after-commit are enforced; no support session or external provider delivery is granted. Native HTTP22PASS plus full OpenAPI25PASS (47combined), including contracts for15 previously undocumented mounted native endpoints. English/Danish Help and the explicit operator guide reflect the resulting behavior. Evidence: `doc/operations/aw-v10-evidence/native-support-operator-2026-10-25/receipts.json`. Actual provider qualification/inbound automation, attachments, erasure/reconciliation and the Agent Package grounded assistant remain open.

All functional changes throughb87b1b7c9 are pushed. Human Readiness inspection is under security review in the working tree; its earlier scoped passes are not a completed V10 or PR-ready claim.


### 2026-10-25 — Human Readiness without a fabricated execution

The original Context owner now has a readonly Human inspection path. It uses the actual Human and the original native scoped authorization transaction, carries current credential expiry through completion, and creates no execution manifest, retained source edge or fake Run. Canonical Task, Memory/derived lineage and exact approved Foundation revisions are checked before and after the assessment write. Foundation pointers/revisions stay locked until commit; complete approved Foundation evidence participates in evaluation and the source hash. Unsupported external execution Context stays unavailable. Bounded Foundation evidence fails closed above256documents/2MiB.

Runtime assembly still requires its actual accountable native Run. Agent Readiness now carries its existing actor.runId into that original owner and retains its full approved Foundation evidence. Activity publication is buffered until the owning transaction commits; a native trigger regression changes a selected source after insertion, proves final recheck rollback and verifies no activity event escaped. Current readiness9PASS includes actual Agent Run positive/no-Run denial, authenticated Human/private Task positive, other Human/tenant denial, grant revocation, original credential expiry, Task deletion blocking and two-connection Foundation approval waiting across commit/rollback. Server compiler passes. Native runtime actual-run control1PASS is separately retained.

The representative full package run improved to106PASS/9FAIL, with six native Agent tests started before the actor.runId correction; the corrected native first-result representative passes. Three stale fixtures still require canonical Routine/Memory creation and the fresh complete package run remains pending. The failed run is retained, not relabeled green. Evidence: `doc/operations/aw-v10-evidence/readiness-human-2026-10-25/receipts.json`. Full temporal source closure, current private Routine SQL policy and remaining V10 gates remain open.


### 2026-10-25 — Complete original package integration passes

The full original Agent Package integration suite passes115/115. Six prior native first-result failures are resolved by carrying the actual Agent Run through Readiness. The three remaining stale fixtures now create conversation Routines through the original authoring service rather than retargeting immutable identity, and create/accept Human Memory through its canonical service rather than inserting unqualified rows. Privacy, cross-owner denial, Learning review and source-erasure assertions remain. The four existing Context/Readiness policy suites also pass32tests. Evidence: `doc/operations/aw-v10-evidence/package-readiness-canonical-2026-10-25/receipts.json`. This supersedes the preceding106PASS/9FAIL checkpoint for that complete package file, whose failure log remains retained. It is not a whole server or complete V10 pass.


### 2026-10-25 — Actual Memory producer fixture and retained publication failure

The original Memory core fixture now creates a persisted actual native Task/Run with its accountable Human and original identity initialization for Agent-produced candidates. Missing-Run capture explicitly rejects403 with no saved candidate. The two private visibility fixtures use the existing dedicated Agent-private writer; all owner/tenant/review boundaries remain asserted. An arbitrary `memory-test` service name has no current Source actor and correctly receives no private content; the actual owner Agent positive remains. The company cascade control uses a Human producer so deleting upstream native Runs cannot erase Memory before its own cascade assertion. Cleanup follows the additional native lifecycle/permission rows.

Current complete file24cases:23PASS/1FAIL. The remaining failure is real: an explicitly proposed private share accepted by its original Human remains hidden to the target Agent because no exact publication receipt crosses that private-source edge. Source lineage/erasure must remain, and this is being implemented at the original share/review/source owners. Earlier fixture-cleanup failures are retained; a concurrent mid-edit Routine authorization compiler failure is not a Memory compiler pass. Evidence: `doc/operations/aw-v10-evidence/memory-native-producer-2026-10-25/receipts.json`.

The V10-required upstream package register is now present at `2026-10-18-blentera-v10-upstream-integration.md`, retaining exact brief source identities, original owners, current software evidence and outstanding package reconciliation. Its pending entries do not remove mandatory implementation obligations.
