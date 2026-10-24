# Blentera V10 native payload source contract

Implementation contract. The closed shared representation and original-owner DB binding now have a bounded16-test checkpoint, recorded below. Actual input capture, source-aware reads and the original native Task/private Memory and temporal regressions remain open. The source-only sections retain the design history; their no-implementation statements describe that earlier checkpoint.

Native captured-input / dispatch source contract refinement — 2026-10-23
STATUS: READ-ONLY DESIGN. No production/schema/test changes, migration or check launched. Extends up03-native-payload-receipt-design.txt. Existing Task/private-Memory RED remains open; source tracing is not GREEN qualification.

1. Actual delivered input owners and existing proof

A. Task/bootstrap prompt: heartbeat.ts buildPaperclipTaskMarkdown (8526), taskMarkdownInput (20860), native constructor (23578), and nativeExecutionInput persistence (23773).
- Task id/title/description/work mode, up to6 ancestors, sanitized current wake comment(s), interactions/accepted-plan routing, exact plan document/revision/body, continuation summary, and conversation replay can enter task text.
- getIssueExecutionContext/current body and ancestors are live DB reads; rendered string alone does not retain their body versions or captured payload roots.
- conversationReplay in agent-conversations.ts356 selects up to40 exact current nondeleted comment rows, then returns only author/body strings (8000 chars each). Preserve row IDs/version/body hashes BEFORE render discards them.
- Inline wake snapshots retain comment IDs/createdAt and attachment descriptors, but not a complete current body-version/content-root receipt. Metadata/sourceTrust affect trust presentation, not permission provenance.
- Questions/answer chains and plan/review bodies are separate persisted interaction/revision sources; include actual returned source revision/result digest. Do not infer them from model text.

B. Governed Context: context/context-runtime.ts assembleFreshNativeGovernedContext invokes Context engine then returns ONLY markdown. Its actual manifest exists in DB but the return value discards manifest identity.
- Change the original internal return contract, when implemented, to carry the actual created manifest reference together with markdown. No search for latest Context by timestamp and no parsing rendered citations as authority.
- context-manifest.ts already pins selected native Task version under SHARE, checks exact updatedAt vs sourceVersion, stores contentHash (title+excerpt), and pins Memory roots/current versions. It does NOT snapshot the selected Task body's then-current payload dependency closure.
- Selected Task sourceVersion/contentHash identifies the captured rendition; future Task edits must not silently replace that rendition's dependency roots. Current Task ACL remains independently revocable.

C. V5 execution inventory: agent-runtime-fabric.ts prepare + execution_manifests schema.
- Existing manifest pins actual Context refs, Skill/version, Playbook/revision, RolePack/version, capabilities, provider/policy, Agent identity and responsible Human.
- It has no universal Task/body/ancestor/comment/attachment/plan receipt. Fabric can returnnull with featureoff; cannot make this optional feature the mandatory privacy proof without explicitly changing that product contract.
- Manifest is once-per-run. Re-prepare creates fresh Context/authorization rows while reusing stored manifest. Do not assume stored manifest.contextManifests equals every subsequently delivered input.
- Existing learned pin retention adds Memory roots to actual local Context and retains learned assets. Reuse this authority owner; version pins/catalog eligibility are not payload grants.

D. Instruction/Skill/Playbook/Knowledge/Memory assets: native-runtime/runtime-context.ts341/372/420.
- NativeRuntimeContext includes prompt digest, instructions content-addressed bundle, selected Skill version+bundle and aggregateDigest.
- materializeInstructionBundle appends authored Playbook bodies, selected approved Knowledge revision bodies and approved work-preference Memory bodies into the instruction entry file.
- buildRetainedNativeRuntimeContext stamps actual authored Memory Context roots, selected Knowledge version/body hashes, Playbook revision/body hashes, and authored definition hash BEFORE materialization, even without V5 fabric.
- Keep exact asset digest/version refs and these original source roots in the input receipt; a SHA proves bytes, not current permission. Current authored/learned source checks remain required.
- Eager skills use resolved actual versions; on-demand loadSkill/loadPlaybook are additional later actual reads. On-demand pins must retain original source dependencies before returning body, not merely claim that catalog selection equals loaded bytes.

E. Attachments after persistence: native-session-executor.ts7210/7230 calls stageNativeRunnerWakeAttachments and appends stagedPrompt to a NEW parsed execution.task.prompt before executePaperclipNativeSessionWithinScope.
- Therefore runnerProfileJson.nativeExecutionInput is NOT the final complete provider prompt.
- native-runner-file-handoff.ts803/929 reads actual tenant Task/attachment/comment/asset binding; readBoundedStorageObject verifies asset byteSize+sha256 before staging bytes. Returned stage descriptors omit that verified SHA; internal receipt must retain it without adding wire authority or local paths.
- Unavailable/remote-unsupported attachments are explicit omissions, not delivered payload. Include only actual descriptor/omission source policy plus verified bytes for successfully staged items; never substitute another file.
- NativeChatAttachmentReadScope.read can later return historical exact conversation bytes, SHA and sourceCommentId/attachmentId after current authorization. Its process-local scope/lifetime is not durable provenance. Add native source stamping before body/path becomes available to provider; never persist temporary workspace paths.

F. Paged comments and later tools: current-wake-comments.ts resolves exact comment-ID binding and bindingDigest, creates full snapshotDigest, and persists ordered page receipt in actual run.resultJson before response.
- Last-page receipt is overwritten; full snapshotDigest and binding IDs can qualify the original snapshot, but are not a complete append-only history of every different later input snapshot.
- Native tools that return Task/Memory/Foundation/procedure/connector content are additional inputs. Preserve their original existing audit/Context/retained-root owner; do not mark a run complete solely because its initial bootstrap was complete.
- Tool catalog/management API reference/static prompt strings are source-free policy/configuration content only when original server owner proves that category; arbitrary tool response prose is not.

2. Lifetime, steering and recovery

- heartbeat23378 reuses persisted input; native-session-resume.ts267 deep-compares parsed existing input and refuses rewrite. Recovery must preserve original admitted bytes/receipt, not reassemble current Task data into old input.
- run-identity.ts accepts acknowledged same-run Human steering and changes actual run Human/activeIdentityContext; it does not rewrite bootstrap input. Immutable input provenance records original accountable identity; current reader/effect principal must always be fresh actual Agent x Human. Steering is never private-source publication.
- continuation-contract.ts can replace nativeExecutionInput only at fenced uncompleted contract CAS. No production caller found by complete symbol search. Treat as dormant exception requiring receipt preservation/digest CAS before activation; do not claim it is today's normal mutation path.
- Warm session continuation can retain prior turns/transcript/workspace. A new run needs prior actual retained input source closure or bounded qualified prior-run receipt, not just matching session ID/provider/workspace. Unknown pre-protocol session cannot become source-free by restart/fresh input construction. Fresh protocol session vs retained prior history must be explicit admission.

3. Smallest proposed native persistence contract (representation requires schema-owner review)

- Reuse existing heartbeat runnerProfileJson.nativeExecutionInput for already persisted bytes; do not duplicate private prose into a new provenance table.
- Add a closed SERVER-ONLY native-input source receipt on that ORIGINAL run owner (candidate runnerProfileJson.nativeInputSources). No new table, generic registry, actor DTO grant, public receipt or permission cache.
- Bind company/run/Agent/Task, exact bootstrap input digest, actual final dispatch/staged-attachment digest, and original source identity/version/hash snapshots. Families are closed to the actual native inputs above: base Task + ancestors; comments/interactions; document revisions; asset/attachment/comment tuples; actual Context IDs; authored definition and Skill/Playbook/Knowledge revision+asset hashes; prior retained session inputs.
- For each copied body source, retain its THEN-CURRENT PAYLOAD root closure and a separate CURRENT POLICY anchor. Bare Task UUID/updatedAt/hash cannot recover lost old dependencies. A body receipt's provenance version is not a grant and need not equal today's edited body when old immutable captured roots remain known; current ACL/erasure still narrows it.
- Record before first provider transport. Post-bootstrap actual input reads append retained source sets through their ORIGINAL owners before returning data. Union only; no caller-declared completeness, no body/ID inference from metadata, no generic event collector that guesses what the model used.
- Source snapshot capture must be after relevant source/run waits under existing BusinessEvent -> Memory -> source/privacy ordering, with current actual Human/Agent admission. Filesystem hashing/staging does not hold principal locks across I/O: retain verified hash, then final source revalidation+receipt commit before transport. Failures stop dispatch; cleanup stays with existing staging owner.
- Run0506 source_context_provenance_qualified is INSERT-only/no false->true update. Distinguish protocol-capable writer admission at run INSERT from base-input receipt READY after actual assembly/staging. Child payload effects require BOTH a new-protocol run and complete ready receipt; a newly inserted protocol bit alone does not prove future or initial data already captured. Old runs stayfalse; old warm-session history remains unknown.
- At a Task/Project/Memory effect, pin actual run SHARE and snapshot its current retained Context IDs plus exact ready base-input root closure inside SAME native effect transaction. Commit these exact payload dependencies with the effect, not after commit. Context append/steering must serialize on that actual row; current Human rechecked after final waits.
- The earlier proposed Task/Project payload_context_manifest_ids is sufficient ONLY if every captured non-Context body dependency is flattened into equivalent original retained Context/root receipts. It cannot represent unretained comments/assets/procedure roots by itself. Stop at this representation boundary: do not silently omit unsupported source families or add a pointer to a MUTABLE latest-run receipt and call it an exact old snapshot. Copy the bounded exact root closure into the original child owner's retained source fields, or add only the missing closed original-owner payload field after review.
- Native comments, documents and attachments created from a run likewise need creation-time source snapshots at their ORIGINAL writers. createdByRunId/originatingRunId alone cannot recover which earlier Context inputs existed at creation. Unknown historical/native-copy versions remain unqualified; current body hash is not a reconstruction algorithm.

4. Original graph roles and temporal counterexamples

- Extend only original authorization.ts bounded graph: distinct POLICY vs PAYLOAD nodes; exact source/company existence; complete cardinality/work budgets; active-path cycle detection. No second source engine.
- Own producer run/Task are POLICY anchors: current private Task/conversation/project/parent/current Human restrictions apply, but do not expand their later body/current Contexts as an old payload dependency.
- Actual captured base Task body + selected Task/Memory/Foundation roots are PAYLOAD snapshots. Expand only captured Context/root snapshots, never every future Context of source run or current Task body.
- T0 public Task -> runR ready receipt with no Memory inputs -> M1. Later ContextC onR selectsM1: M1 stays readable to original current Agent/Human because M1's producer anchor is POLICY, not R's future ContextC. A new M2 created afterC retains actual M1 payload; M1 never gains C retroactively.
- Duplicate/corroboration after selectingM1: keep existing resolver exact selected-target sourceVersion/locked-row receipt rule. Direct target self-edge can disappear only when no new payload/evidence/authority consequence is discarded. Indirect M1 -> Foundation -> Learning -> M1 still denies. No general ancestor cycle skip.
- Old selected Task body whose current row later changes: retain old captured body roots; independently evaluate current Task privacy/parent/project/membership/erasure. Do not inject later body input roots and call a false cycle a security requirement.
- Selecting the own Task is not permission to drop provenance: reuse its exact pinned body/version/root snapshot rather than a live self-payload edge; the own Task POLICY anchor remains. Exact same body snapshot can be deduplicated, while different/indirect payload cycles still deny.
- Same canonical graph must filter SQL BEFORE count/list/search/facets/fuzzy fallback/limit. Async detail guard cannot close title/count leaks. Existing genuine Task/privateMemory RED must turn green with allowed original owner/Agent positive.

5. Canonical Foundation permission / transaction lifetime

- Canonical authority remains authorization.ts decide(action foundation:read, actual company resource, enforceResponsibleUserIntersection:true), including actual grant scope/key/trust/Agent x Human behavior. Do not replicate it as a membership-only SQL IAM predicate.
- Normal owner/admin company membership alone is not a Foundation grant. Canonical local-implicit and nonSaaS instance-admin branches DO exist; document/preserve reviewed canonical semantics rather than falsely claim every decision needs direct grant. A Foundation allow never bypasses private Memory/Task roots or actual current accountable Human requirements.
- withReadSources currently whitelists only issue:read/project:read; foundation:read presentlydenies there. Extend ONLY this original owner with same-company company-resource Foundation read, not arbitrary new actions.
- Existing prepared membership/instance-role reads, findGrant, loadResponsibleUserSnapshot/loadAgent are fresh but not row-pinned. Pin ONLY actual positive native authority facts used by original Foundation decision (actual user/account, active membership, applicable Agent/run/key/grants/instance-role), on actual outer PgTransaction. NOWAIT is the existing proven option when native account/Agent revocation order can invert; busy denies/409, never permission grant or generic retry bypass. Review specific grant/key revocation order and test it.
- Current issueReadSqlCondition/projectReadSqlCondition return SQL from autocommit callers and do not use db. Temporary internal TX followed by escaped SQL is INVALID. Actual SELECT/count/page execution must stay inside SAME canonical native read transaction/company callback. Check active callback scope + actual physical transaction if a proof can otherwise escape; no DBregistry or global cached allow.
- Pass actual known company from owning query. Cross-company owner must qualify each actual bounded company through original permission owner inside same transaction; actor.companyId/DTO membership lists are not actual query scope. No unbounded company enumeration or blanket Foundation boolean for multi-tenant SQL.
- Original query owners requiring transaction adaptation include issues/projects routes and list/read/count functions; company-search/search-extract/portability; native metrics/strategy withReadSources users. Original row source owner is the canonical reuse boundary, not adding per-UI checkboxes.

6. Next actual qualification (NOT RUN)

1) Existing7-assertion native Task/privateMemory RED -> green for SQL list/search/detail/count beforelimits, plus Alice/AgentA positive; missing/foreign/tombstoned source and unknown histories denied.
2) TaskI -> M1 -> later ContextI selectsM1 -> original actor still reads and duplicate/corroboration no-op does not append selfroot or commit corrupt row. Fresh private consequences remain retained.
3) Actual Memory -> Foundation -> Learning -> Memory active-path cycle denies; legitimate diamond passes.
4) Capture base Task/private ancestor/comment/plan/attachment roots, then edit current body/add later Context: earlier payload retains EXACT old inputs; new effect captures new inputs; current ACL withdrawal revokes both.
5) First provider transport observes committed ready receipt including staged verified asset SHA; induced receipt failure sends no first transport. Unsupported/omitted attachment never becomes fake delivered file.
6) Restart reuses exact receipt; same-run acknowledged Human steer cannot adopt earlier private source; fresh run with retained warm session preserves prior roots or refuses unknown session history.
7) On-demand Skill/Playbook/comment page/chat attachment actual return stamps receipt before effect capture; lost response may overretain conservatively, never authorize omitted sources.
8) Canonical Foundation parity: normal Human no grant; Agent-only/Human-only grants; limited-scope grant; key/trust restriction; actual account/role/grant withdrawal during held native wait; positive exact grants/current source; same physical TX and escaped/autocommit-proof denial.

No production implementation, schema lease or release assertion follows from this design. Source/completeness, old writer/rollback admission, all native tool reads, copying writers and every delivery surface remain explicit qualification gates.

7. Explicit schema / owner decisions before implementation

A. Preferred first source container is a closed server-owned field on existing heartbeatRuns.runnerProfileJson, bound to nativeExecutionInput digest; alternatively dedicated original heartbeat columns if SQL validation/immutability cannot be enforced safely in existing profile JSON. No new receipt table. Base receipt immutable; additional actual input roots append-only. Effect copies exact bounded closure, not a mutable latest receipt pointer. Schema owner must choose representation and native trigger enforcement before coding.
B. Earlier Task/Project payload Context UUID arrays may remain minimal if actual bootstrap/non-Context sources are converted to equivalent original retained source receipts. Otherwise add only missing closed payload-root fields on original Task/Project/Memory/comment/document/attachment owners. Do not silently declare the arrays sufficient before mapping every delivered family.
C. Existing selected Context Task item needs exact body-root snapshot plus sourceVersion/contentHash; decide typed item columns versus validated server-only item metadata with immutable DB enforcement. Caller-provided item metadata cannot certify completeness.
D. New run INSERT protocol capability vs later immutable base-ready receipt must be separately enforced. Current0506 false historical rows and unknown warm sessions stay unqualified. No in-place false->true upgrade. Mixed-writer/old-reader/rollback admission remains a deployment gate; this design does not close it.
E. Foundation permission proof: extend original withReadSources whitelist only same-company foundation:read on company resource, native positive-row pins and transaction lifetime; move actual source-sensitive SQL execution into that owner callback. Autocommit condition construction cannot create reusable permission SQL. Review concrete query-owner adaptations and pin lock order; preserve canonical local/instance exceptions and actual Human/Agent source narrowing rather than cloning a permissive membership predicate.
F. Dynamic tools/continuation/history: choose the exact supported first-wave input families before setting protocol capability for any constructor. Unsupported tool response/source family refuses source-qualified derivative effects; it is not silently treated as source-free. Ordinary native worker functionality and terminal claimed Memory capture semantics must remain explicitly supported, not disabled through a new opaque flag.

Finalized source-only on2026-10-23. All repository files remain untouched by this design task; no production/schema/check/session action performed. Existing actual RED and existing qualified checkpoints remain bounded to their recorded source bytes.

## Representation checkpoint — 2026-10-23

The shared closed snapshot parser and exports are implemented (`9596e88b2`). Generated migration0509 adds nullable snapshots to the original six payload owners and selected Context items, with an immutable insert-time writer protocol. Native triggers bind nonnull snapshots to company, owner, actual payload hash and PostgreSQL-canonical digest, retain prior nonnull source sets, invalidate Memory/attachment snapshots after child payload changes, and reject Context selection rewrites. Unknown historical rows remain protocol0; no producer is qualified by an empty set or hash.

The current three focused files pass16 tests with observed/durable exit0 and14 unchanged source pins. Earlier actual regressions, exact initial SQL/test source and raw captures are in `up03-native-payload-source-binding-checkpoint.json`. This proves representation and binding only. Original producer stamps, immutable complete run inputs, preservation of unknown history after invalidation, private server DTO handling and canonical same-transaction SQL remain mandatory next work. The copied private Memory and both temporal regressions remain open.

The subsequent bounded public-projection checkpoint passes16 cases and current server compilation: known Task/Project/Memory/Comment HTTP rows, mentioned Projects, heartbeat wake comments and the shared Comment queue DTO remove the two internal proof fields at their original response owners. Actual stored proof and arbitrary nested Memory metadata remain unchanged. This covers11 tested HTTP reads plus the existing Memory lifecycle and queue permission cases; all tools, portability and every other delivery family are not implied. See `up03-native-payload-public-response-checkpoint.json`. Complete actual native inputs and canonical source graph/SQL remain next work.


## Actual dispatch distinction — 2026-10-23

The original Native constructor persists a full bootstrap, while `buildNativeModelEnvelope` may send `continuationPrompt` on a warm session. A base input receipt protects the stored bootstrap bytes; it does not prove every bootstrap portion was dispatched. Derivative effects must capture the actual dispatched/returned input sets, including retained prior history, rather than automatically unioning unsent bootstrap content into their payload. Full run-payload inspection separately protects its stored bootstrap. Context/Task policy anchors remain current without traversing a source Task's future body. No receipt/constructor activation follows from these structural checkpoints.


## Invalidation history — 2026-10-23

Generated migration0513 adds an internal monotonic payloadSourceSnapshotInvalidated bit to the six original payload owners. The existing shared binding trigger sets it on known snapshot → NULL, rejects caller-supplied changes and forged true inserts, and refuses any later snapshot after invalidation. Existing protocol1 NULL rows are conservatively latched during upgrade because their lost history cannot be distinguished from an initially unbound row. Existing nonnull proof is unchanged; protocol0 remains unknown and cannot upgrade. Fresh protocol1 structural initial binding remains possible and still proves no source completeness or permission.

This prevents the reproduced clear-then-rebind loophole. It deliberately offers no recovery/restamping API for a row whose history was lost, and does not qualify producers, complete receipts, mixed writers or restore/recreation. The existing public-row owner removes the new internal field only at the top level; nested user data is preserved. Complete source-preserving writes and the private Memory/temporal read regressions remain mandatory before UP03 admission. Verification is recorded in the dated recovery ledger and evidence checkpoint after process closure.


## Partial attachment admission and repeat preparation — 2026-10-23

Original executor now retains exact stage sourceCaptures in private nativeAttachmentStageSources entries, keyed to committed process-start event seq and owned coordinator attempt. Current locked-run Human is captured as a fact, NULL remains unknown, prior entries survive, and bounds are64 entries/2MiB. Original lease fencing and coordinator→run lock order precede the append; existing analytical access checks run before/after. Write failure prevents admission and original cleanup applies. Empty stages add no entry. These are partial capture-time facts, not a full dispatch/complete input receipt or permission proof; capture-time Human cannot replace later current authority or actual transport identity qualification.

Original repeat preparation now preserves the entire locked current profile instead of erasing input/source/checkpoint histories. It derives canonical turn/item/environment IDs from that row and returns the actual persisted values. Existing reserved recovery-marker semantics remain. Actual PG3-mode preservation and488 executor/stager cases plus final server compilation are scoped in up03-native-stage-history-checkpoint.json. Executor before-provider assertions use the original mock DB/backend fixture, distinct from actual PG stager/preparation evidence. No protocol activation or source-free/Ready admission follows. Complete input receipts, original privacy/temporal regressions and physical commit/transport/effect closure remain open.


## Concrete policy-only counterexample — 2026-10-23

The new original-owner control retains a private Task input through a derived Task assigned to another Human and a subsequent Memory. Assignment does not publish the prior body. Original production withholds the Memory; a temporary blanket policy-only Task/Project traversal returns it. Both temporary candidates were restored and rejected. Preserve exact payload closure before changing anchor traversal. Migration0503 already normalizes heartbeatRuns.issueId; do not add another native Task binding workaround. See the dated ledger and `up03-retained-body-control-checkpoint.json`. The original three failing privacy/temporal cases remain mandatory.


## Direct native body writer lifecycle — 2026-10-23

The native Task updater, environment selection, plugin policy, forecast, monitor, failed-workspace retry and status blocker paths now explicitly preserve unchanged captures or invalidate changed bodies at their existing owners. Memory root and five derived Task/Comment/revision erasure updates invalidate with erasure. The original binding trigger still rejects arbitrary stale direct writes, and its irreversible unknown latch still rejects rebinding. These mutation checkpoints do not capture complete new input closures or activate any constructor. Other Project/Comment/Memory/Document mutation families remain unqualified. See the dated recovery ledger and `doc/operations/aw-v10-evidence/native-body-writers-2026-10-23/checkpoint.json`; original private-Memory and temporal reader regressions remain open.


## Actual selected turn input — 2026-10-24

The original runner now exposes an awaited finalized-input boundary immediately
before `NativeSession.startTurn`, after warm continuation and semantic-result
recovery choose the actual message. The callback observes a detached copy; it
cannot rewrite the original backend call. Existing active/terminal adoption and
goal-control-only paths do not fabricate a fresh input. A persistence rejection
uses the existing startup abort/cleanup owner and prevents that turn from starting.

The server binds a bounded `nativeModelInputDispatchIntents` history to the real
launch event, current coordinator lease/attempt, native run and its then-current
responsible Human (NULL stays unknown). It retains digest/byte count and the
actual continuation flag, without copying model prose, paths or credentials.
Original profile/history is preserved; exact returned persisted intent is checked
because source/erasure triggers may suppress writes. Unexpected DB errors are
normalized without their private profile/query parameters. The shared native
lease renewal now uses database wall time, including after transaction waits.

These are pre-I/O dispatch intentions, not provider acknowledgements or complete
source captures. No constructor is upgraded, no complete receipt is synthesized,
and no source-free/Ready/private-work admission follows. Complete input-family
capture and original privacy/temporal regressions remain mandatory. Actual native
PG controls first reproduced lease revival, private SQL error leakage and silent
write suppression; final PG10 + executor mock471 + runner mock142 and targeted
compilers/build pass. Evidence:
`doc/operations/aw-v10-evidence/native-model-dispatch-2026-10-24/checkpoint.json`.

## First native manual Task producer — 2026-10-24

The original HTTP create owner now supplies its actual Board session actor to
the existing Task transaction. Only an independent, open, manual backlog/todo
Task with direct text and no related, assigned, generated or retained-workspace
inputs uses this first producer. Native session/User and current non-viewer
membership are pinned; the existing instance-role fallback additionally needs
recent phishing-resistant native proof. Database wall time is checked again
after intervening waits. Creator attribution alone cannot activate capture.

The original insert selects protocol1, binds the actual stored body's canonical
hash/digest, and persists the actual Human's source-capture audit in the same
transaction. This constructor is now active only for that narrow manual input
family. Empty upstream inputs record that admitted direct input; they are no
grant to private sources. Historical/deduplicated/unsupported rows remain
unknown, and no Native run input protocol is activated. Operational edits retain
the binding; changed body content invalidates it irreversibly through the
existing updater. No restamping operation is introduced.

The first built-app check reproduced internal-proof leakage in the original
create response. Create/dedup and Task update responses now use the existing
public-row projection, including their known nested comment. Native PG covers
stored-body binding, authority denials, real lock-wait expiry, audit-failure
rollback, dedup, unsupported initial plans and update invalidation. The actual
built cookie-session browser checks both the public response and private DB
binding/audit, then completes its existing authenticator lifecycle.

All other constructors, complete run receipts, canonical source-aware read
families and the original three privacy/temporal failures remain open. Three
broader legacy route failures also reproduce against the unchanged parent
production files; their source contracts still need reconciliation. This is
neither complete source support nor full V10/PR acceptance. Evidence:
`doc/operations/aw-v10-evidence/native-manual-task-2026-10-24/checkpoint.json`.

## Canonical persisted run identity — 2026-10-24

Native Task source reads now share one SQL binding check, including the direct
run reader and recursive Task/Project list/count paths. A genuine company run
has no Task identity keys or UUID anchors. An issue run must retain exactly one
UUID identity across `issue_id`, `native_issue_id` and context `issueId`/`taskId`;
case-equivalent UUID spellings are the same identity. Malformed/unknown contexts,
conflicting identities and a display Task key without a UUID remain withheld.
Existing current ACLs, source traversal/bounds and action policies still apply.

The parent-production control reproduced an ambiguous native run being readable
directly. The final real PG check covers both Run and derived Task denial and
case-equivalent valid references. Legacy positive route fixtures now construct
Projects through their actual local-trusted HTTP owner and retain explicit,
consistent Task UUIDs; separate negative rows preserve the original ambiguous
and Task-key-only data. The earlier three route failures are reconciled without
loosening source policy. Final verification passes124 cases in five suites.

The separate seven-case typed-origin regression now uses valid transactional
Workflow revision/backref fixtures. Four negative cases pass; valid Workflow
and Routine creation still incorrectly seek heartbeat rows, while an unrelated
same-UUID company heartbeat can substitute for a missing WorkflowRun. Those
three failures and the original three private-Memory/temporal failures remain
open (six failures/five passes across three focused suites). Typed owner lookup,
retention triggers, canonical read semantics and exact revision ownership must
be fixed together; no generic UUID fallback, provenance flag or private-source
grant is introduced by this checkpoint. Evidence:
`doc/operations/aw-v10-evidence/native-run-binding-2026-10-24/checkpoint.json`.

## Direct Human Project producer and replay lifetime — 2026-10-24

The original Project HTTP transaction now admits the second narrow direct
Human producer: an independent open Project with direct name/description/icon/
color and no related goals, sources, repositories, workspace, environment or
policy input. Its actual native User/session and current member/operator path
are pinned before the privacy locks. The original insert selects protocol1;
the actual stored body is bound and its Human capture audit persists on the same
transaction. Operator fallback additionally requires recent native passkey
proof. Historical, service-only, key-authenticated and unsupported inputs remain
unknown; idempotent replay never upgrades the original row.

Task and Project reuse the original DB body-hash/digest contract through one
small SQL expression and the same final native-session wall-clock check.
Existing Project operational edits preserve proof; body edits and the existing
budget/policy/environment/reset owners invalidate changed proof. A real source
audit write failure rolls creation back. Internal fields remain absent from
public responses. No Agent/generated constructor or run protocol is activated.

Two additional real-lock controls reproduced Task dedup returning an old body
after its member session expired or its instance-admin passkey event aged out.
Task creation/reuse/dedup now shares one successful-return finalizer; Project
replay also rechecks operator proof. The original unknown Task and receipt stay
unchanged. The member test uses native DB session rows; the operator test uses
the explicit structural passkey fixture, not a claimed crypto ceremony.

Current owner/public-projection checks pass32 cases in three suites; the two
isolated replay controls pass. The earlier four-suite body-binding checkpoint
passed59 cases before the final replay change. A later combined run timed out
in native DB setup and was interrupted with exit130; its skipped cases are no
pass qualification. Smaller current checks complete without extending their
timeouts. The real built cookie/authenticator browser checks both actual stored
Task and Project bindings/audits. Exact inputs, raw failed gates and current
source pins are retained in:
`doc/operations/aw-v10-evidence/native-manual-project-2026-10-24/checkpoint.json`.

The six typed/private-Memory/temporal failures, remaining producers/mutations,
complete input receipts and read families, portability/Context/readiness and
full V10/PR admission remain open.

### 2026-10-24 — original direct Human comment constructor

The ordinary HTTP comment branch now passes its actual native Board/session
actor to the original comment owner. Only independent user body input, without
run/agent attribution, structured metadata/presentation, attachments, imported
timestamps or specialized authorizations, enters the direct producer. Other
comment constructors and attachment/conversation/special-decision branches
remain unknown. No author UID or client-provided proof field supplies capture.

The original transaction pins native User/session and current write membership
(or native recent passkey-qualified operator role) before privacy-tree and Task
locks. Canonical current comment permission and Task privacy narrow admission.
The fresh INSERT chooses protocol1; final stored comment bytes are then bound
to their DB body hash/digest with the actual Task as a current policy anchor,
not a claim that the Task body was copied. The actual Human source audit is in
that same transaction and its notification follows commit. Final source-session
and operator deadlines apply to successful new writes and old replays.

The Task row serializes exact user/request-ID lookup before the constructor.
Historical protocol0 and unknown protocol1 comments remain unknown; neither
dedup nor attribution can reconstruct their lost source history. The internal
INSERT protocol argument alone creates no known snapshot or grant. Existing
queued-body edits, metadata upgrades and erasure writers invalidate changed
body proof; operational trust/session-generation metadata remains outside the
comment body hash. The original tombstone test verifies monotonic invalidation.

Actual focused PostgreSQL checks cover these properties and audit rollback.
The built cookie/authenticator browser additionally checks the original HTTP
producer's stored hash/digest and actual Human audit. This slice does not
activate a run receipt, qualify model input completeness, fix the six remaining
typed/private-Memory/temporal cases or admit private work/full V10/PR readiness.
Evidence: `doc/operations/aw-v10-evidence/native-manual-comment-2026-10-24/checkpoint.json`.

### 2026-10-24 — actual first document revision capture

A fresh ordinary HTTP document now carries its actual native Board/session
actor into the original upsert owner. No base revision, Agent/run attribution
or locked-document copy may claim independent direct input. Existing, edited,
restored and imported versions retain their original unknown/known status.

The original transaction pins actual source credentials and current membership
or recent native operator proof before privacy/Task waits. Canonical Task write
permission and current privacy remain required. Its first revision chooses
protocol1 at INSERT. The later same-transaction binding hashes the actual stored
revision and selects its Task anchor from the just-inserted unique same-company
link. Its actual Human audit follows the native Task entity; only committed
publication is emitted. Failure or expired source authority leaves no document,
revision or link. Public document and revision projections omit private fields;
the existing selected-source callback retains the actual revision snapshot.

The9-case actual native owner,33-case relevant regression suites, extended built
cookie/authenticator browser and compiler pass. Complete run receipts, all six
remaining typed/private-Memory/temporal cases, other producers and read lifetime
closure remain open; no run protocol/private-work/PR admission is activated.
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
