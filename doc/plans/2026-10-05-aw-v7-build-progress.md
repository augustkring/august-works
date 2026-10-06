# August Works V7 full-brief implementation ledger

Date: 2026-10-05. Branch: `codex/aw-v7-build`. Source: user-supplied V7-v2 build brief.

The user has requested implementation of the whole brief. Work continues through all twenty waves. Code, local tests, provider qualification, customer validation and production acceptance are separate evidence states. Default-off flags remain closed until the relevant evidence exists. This ledger must not label a declaration or scaffold as a completed feature.

| Wave | Deliverable | Current evidence state |
| --- | --- | --- |
| 0 | Post-V6 audit and rollout contracts | Configuration slice committed; predecessor/provider/legal acceptance remains scoped/open |
| 1 | Readiness and Knowledge Quality | Implemented: schema, policy, authorized source integration, scoped API and UI; eleven service/policy and three UI tests pass |
| 2 | AI-assisted Foundation bootstrap | Implemented and locally verified; six migrated-PostgreSQL tests pass |
| 3 | Cognitive provider contract | Implemented with stateless local/no-op providers; five integration tests plus V4 regressions pass |
| 4 | Hindsight spike and adoption decision | DEFER decision recorded against pinned v0.10.2 source; no production provider admitted |
| 5 | Observations and Mental Models | Implemented with reviewed root lineage, leased rebuilds, Context/UI and erasure guards; local verification passing |
| 6 | Organizational Learning | Core and eight native target adapters verified, including evaluated Optimizer candidates; Agent Package adapter now implemented in Wave 15; broader evaluation and integrated acceptance remain open |
| 7 | Bounded orchestration | Canonical admission/control and reviewed terminal acceptance/joins verified locally; broader compound-budget and automated-provider qualification remains scoped |
| 8 | Deterministic supervision | Canonical observer, deterministic arbiter, durable Stop/retry queue and stopped-worker reassignment implemented; local verification passing |
| 9 | Semantic supervision and verification | Automatic server-side trajectory and verification consumers implemented and tested locally; live provider/calibration qualification remains required |
| 10 | Work Signals and follow-up | Conservative source-bound extraction, human Roadmap drafts and durable native review cards verified locally; semantic provider and live Slack qualification remain scoped |
| 11 | Sandbox abstraction | Backend contract, strict compiler, native cell binding, qualification harness and fail-closed admission locally verified; physical OpenShell enforcement belongs to Wave 12 |
| 12 | OpenShell backend and qualification | Actual pinned prover and conservative adapter verified; physical/native-host/broker qualification remains open |
| 13 | AI purpose and assurance governance | Versioned registry, accountable assessments, native execution fences, durable Stop, obligations and bounded evidence export verified locally; package inventory extends in Wave 15 |
| 14 | Free Core and capacity | Native no-card baseline, atomic concurrent-run capacity and scoped managed-runtime downgrade locally verified; launch economics remain an acceptance gate |
| 15 | Agent Packages | Native version/hash distribution, scoped install/activation, Readiness, commercial products and Learning proposals locally verified; automatic low-risk stewardship and live package outcomes remain scoped |
| 16 | First specialist candidates | Three bounded draft candidates and current native-review evaluation projection implemented; observed customer demand and representative live work remain release gates |
| 17 | Core Stewards | Native metadata findings and opted-in unchanged-content package update consumer implemented; existing privacy/governance/supervision jobs retained |
| 18 | Enterprise operating envelope | Native SSO/SCIM, scoped decommissioning, signed bounded security-event delivery, supplier metadata and V7 state export locally implemented/verified; actual IdP/receiver, operating-contract, supplier/legal and exit qualification remain GA gates |
| 19 | Integrated pilot and fault injection | Local compound hardening and evidence-coverage checker implemented; final repository verification, forced worker broker, physical host admission/credential use and actual live pilot remain incomplete |

## Wave 1 implementation

The same incomplete company receives advisory warnings for an internal draft and a block for external communication. Thirteen quality dimensions remain separately inspectable. System rules cannot be removed by a company rule. Company requirements publish immutable versions with an expected-version check. Assessments bind agent, requesting principal, subject, source versions, exact requirement snapshot and policy hash. Retrieval uses the existing Context authorization and current agent/user intersection; approved Foundation reads use canonical governance and revision pointers.

Findings remain scoped to the requesting principal. Resolution requires a current successful assessment for the same agent, subject and action; it does not edit old assessment history or bypass a hard gate. Experimental UI navigation and route admission both check effective flags.

Verification: six policy tests and five migrated-PostgreSQL service/API tests pass, including principal/tenant denial, permission revocation and concurrent version publication. Three gate UI tests pass. Shared/server/UI TypeScript and all token gates pass in the current local slice. Full final checks will run again after all wave implementations stabilize.


## Build environment

Rust 1.97.1 with rustfmt is installed under `/workspace/aw-v7-toolchain`. The repository toolchain pin is unchanged. pnpm invocations use 9.15.4 through `/workspace/aw-v7-tools/pnpm`. Native prerequisites now run; the earlier missing-cargo limitation is historical. Baseline checks encountered in-progress source while new exports were being added; final checks will use a stable revision.

The Wave 5 checkpoint passed repository-wide typecheck and build. Its initial full `test:run` was intentionally interrupted during general-server execution to continue implementation; it is not a passing full-suite result. The complete required suite will run on the final implementation. Official Node 24.19.0 headers were hash-verified and installed under `/workspace/aw-v7-node-headers`; build uses `npm_config_devdir` for the existing SO_PEERCRED native addon, without changing repository dependencies/toolchain pins.


## Explicit external acceptance gates

No provider is approved by research alone. Hindsight adoption may be deferred after its spike. OpenShell claims require boundary proof on the selected host/kernel/image/version, not merely a passing policy compiler. Customer-facing specialist selection requires observed customer demand and package-specific outcome evidence. Enterprise GA requires contracted facts and operating evidence. A live pilot needs authorized connected systems and a suitable runtime; fixtures cannot establish production acceptance.

## Wave 2 implementation

Discovery creates an idempotent canonical Task for the selected agent. Fresh Context retrieval supplies authorized evidence and human answers. Candidate claims cite known source versions; uncertainty and conflict remain explicit. A live worker must own the current checkout and execution attempt. Cancellation revokes candidate writes. Optional onboarding questions and material questions are presented gradually, with source class, authority, trust and freshness shown alongside claims.

Creating proposals rechecks source authorization/version/hash, keeps narrower sources behind an explicit publication-policy gate, and uses the existing Foundation draft/proposal lifecycle. Human approval remains separate. Answers dispatch through the existing heartbeat service; dispatch failure leaves the canonical Task available for recovery. No bespoke job scheduler or second canonical knowledge store was introduced.

Verification: six fresh migrated-PostgreSQL tests pass for concurrent idempotency, draft-only publication, question gating/CAS, false citations and changed sources, current worker fencing/cancellation, and untrusted-source sensitivity. Shared/server/UI types, module boundaries and token gates pass. Hindsight and production onboarding outcome acceptance are still independent gates.

## Wave 3 implementation

A narrow provider interface accepts governed projections, scoped recall, synthesis, deletion receipts, health and conformance. Separate cognitive bindings carry company/scope/purpose, approved sensitivity, capability hashes and no secrets. V4 Memory remains the source of truth. Local recall ranks only the currently authorized accepted-record universe and returns original AW records after another eligibility check. Private projections require an explicit private binding, the owning agent and verified accepted sources. Unqualified provider keys are rejected.

The Context Engine has an optional cognitive provider alongside its existing Memory provider. Failure does not remove canonical Memory. Revocation, correction, deletion and restored deletion markers propagate through content-free provider-operation receipts independently of feature flags. Local/no-op providers are stateless, so deletion requires no remote content erasure; persistent providers remain unavailable until qualified. Reconciliation is explicitly bounded to 100 eligible sources per scope and reports that limit, not a full-bank synchronization claim.

Verification: five new migrated-PostgreSQL tests and 23 existing Memory Core tests pass. The cognitive/Context test selection passes 25 tests, including existing principal, temporal and source-boundary coverage. Server/UI TypeScript, module boundaries and token gates pass.

## Wave 4 decision

Keep the provider interface and DEFER Hindsight adoption. The pinned release API, tenant implementation and deletion regression tests were inspected. Default authentication is absent; bank names alone are not an AW tenant authorization boundary. Upstream tests document a cross-bank document-ID collision regression and concurrent deletion/observation cleanup. Those tests were read, not executed in an AW deployment. No EU topology, credential path, independent deletion receipt, restore/exit test, cost/latency benchmark or production operator evidence exists for the selected deployment. The adoption gate stays closed. See `doc/operations/AW-V7-HINDSIGHT-QUALIFICATION.md` and the content-hashed research evidence manifest.

## Wave 5 implementation

AW observations retain accepted shared Memory roots and source versions. At least two independent trusted sources are required for reviewable acceptance; copied claims, repeated source IDs and wholly untrusted roots do not inflate support. Contradictions remain review findings. Agents may propose from a live owned Task attempt but cannot self-approve. Company observations cannot inherit private agent Memory or reduce source sensitivity.

Mental models use an explicitly extractive local synthesis over selected current Memory and accepted observations. Models remain candidates until human review. Rebuild requests enter the existing leased Memory job worker, preserve prior content versions, recheck current administrator authority and source watermarks, and produce another candidate. No new scheduler or parallel canonical wiki was added.

Context reads validate every surviving root version, purpose, scope, retention and current authorization. Derived evidence has no canonical authority domain and carries its original Memory IDs/versions. Root changes make observations need review and models need rebuild; stale prose is withheld. Erasure scrubs derived content and all retained model versions even with flags off. Context manifests retain content-free Memory-root lineage. Existing database erasure guards now cover Context consumers, late/restored writes, run events, Task outputs and compatible run-log erasure jobs; encrypted SaaS log buffers are excluded immediately while object erasure awaits its normal receipt.

Verification: the Waves 1–5 migrated-PostgreSQL selection passes 57 tests; the eight final derived-memory cases also pass. Those cases cover review, poison/duplication, purpose, private/tenant/sensitivity boundaries, revocation, leased rebuild/history, restored deletion markers and late runtime writes. Existing Memory maintenance/job selection passes 21 tests before adding the Context erasure case. Server/UI types, module boundaries and token gates pass. Full final repository checks and live outcome qualification remain separate.

## Wave 6 core implementation

Cycles require accepted verified shared Memory linked to surviving completed canonical Tasks. Hypotheses bind the actual current target baseline, a normalized challenger hash, protected invariants, minimum paired evidence, quality floors and rollback paths. Only a current company administrator can sign the initial manual-review comparison. Distinct Task outcomes are reauthorized and version-checked before proposal creation. Human comparison establishes an association, not causation. Cheaper unsafe or lower-quality candidates fail.

Five domain adapters create native Foundation, Skill, Playbook and Roadmap candidates or minimal typed governance proposals. They preserve sensitivity and scope. Roadmap dates remain unchanged by proposal creation. Native Skill evals remain necessary for promotion. Policy acceptance requires current native permissions, baseline and explicit human acknowledgement. Activity rows are atomic; nested Playbook/Roadmap proposal publications now join the parent transaction.

Domain database guards reject acceptance/promotion after source changes with V7 off. Accepted document/Skill descendants inherit source lineage. Source erasure clears hypotheses, retained evaluations, proposals, accepted document/Skill content and Foundation sections. Restored and late writes are scrubbed. Native proposal/review/publication paths share the existing Memory privacy lock to serialize against deletion.

Verification: ten new migrated-PostgreSQL Learning cases pass. The final five-file regression selection passes 51 cases, including existing Foundation, Skill, Playbook/Roadmap and derived-Memory behavior. Shared/server/UI types, module boundaries and token gates pass for this core. Workflow/Optimizer, Role Pack and Agent Package adapters, additional evaluation methods and integrated acceptance remain open; the Learning core is not a claim that Wave 6 or the entire brief is finished.


### Wave 6 native Workflow and Role Pack adapters

Learning creates a distinct native Workflow draft or Role Pack version and leaves publication separate. Required Role Pack entries cannot be removed, repinned or weakened by a Learning challenger. Native versions inherit original roots through later drafts, published pointers and Workflow execution rows. Consumers and publication enforce current source lineage independently of rollout flags. Revocation pauses affected Workflows and preserves Role Pack assignments in a blocked state until a human replaces their version. Erasure cancels active Workflow runs, clears affected version content and published Role Pack items; source-backed exceptions preserve ordinary immutable snapshot guards. Late writes cannot restore erased prose or drop execution root identities.

Verification: twelve Learning integration cases plus fourteen native Workflow and four Role Pack regressions pass (30 migrated-PostgreSQL cases). Server/UI types pass. The policy review UI test also passes and checks that consent is specific to one proposal and version. Optimizer and Agent Package adapters remain open.


### Wave 6 Optimizer, worker proposals and actual completion

Learning can attach a current native Optimizer evaluation with passed hash-bound security, validation and real engine replay gates. It does not grant shadow/canary/activation. Existing qualification remains authoritative. Learning roots join the Optimizer's existing Memory lineage and cannot be dropped by later evaluation writes. Immutable artifact erasure now has a deletion-provenance-backed exception; source, schemas, compiled/replay/shadow payloads and qualification reports are cleared and restored writes scrubbed. Ordinary snapshot/gate immutability remains enforced.

A live agent with an owned Task attempt can create a cycle and hypothesis, but manual evaluation, policy approval and promotion remain human-controlled. Stop revokes candidate-write authority. Cycle completion observes the native domain's actual current accepted version/effects; accepted Foundation proposals still need canonical review and approval. Pre-proposal cycles can be cancelled. UI shows observed promotion and exposes bounded cycle closure.

Approved learned Foundation Context, selected Skill/Playbook versions and Role Pack runtime pins preserve source Memory lineage in the existing Context manifest. Current source versions and actual-use purpose are checked, including with Learning disabled; run/Task consumers then use the existing erasure and late-write guards.

Verification: 17 Learning integration cases and 16 Context/Runtime Fabric regressions pass together (33 PostgreSQL tests). Four native Optimizer end-to-end regressions also passed during this slice. These are local engine fixtures, not customer pilot or live provider qualification. Server/UI types, module boundaries and token gates pass. Agent Package linkage will be added when Wave 15 owns that domain; other evaluation methods are not represented as manual-review causal evidence.


## Wave 7 bounded admission and control

Plans extend canonical Tasks and their existing accepted decompositions. Simple work retains one worker; deterministic work binds the existing published Workflow revision. Parallel workers use exactly the canonical accepted children, explicit acyclic joins and separate completion contracts. Current assignment, accepted plan revision, requesting human membership, action-specific Readiness and actual Runtime Fabric provenance are rechecked before admission. The native strict contract wire retains the original V7 server-arbiter contract across wake/resume while server-only acceptance data remains in the canonical row.

The plan lock serializes concurrency and cumulative retries. The original deadline cannot move, and worker/budget pins cannot be rewritten. Platform tool transitions charge a durable receipt once under the same plan lock before provider dispatch; Pause, Stop, changed ownership, rollout rollback and exhausted budgets close that path. Canonical heartbeat/Workflow dispatch and cancellation are reused. Human controls remain available through the API after the experimental feature is disabled. A requested model cost cap remains closed until an actual pre-spend broker is qualified; accounting after spend is not described as a hard pre-spend cap. Delegated company execution remains closed for bounded plans until its side-effect and budget receipts are linked; existing ordinary V5 delegated execution remains available.

Material action classes cannot weaken their consequence floor and require declared authoritative postconditions; external, financial and destructive actions require approved exact-arguments receipts. Narrative-only Task completion is blocked at the database boundary while a plan is live. Completion acceptance, independent verification, released joins, reassignment and periodic intervention continue in Waves 8–9; the current core is not a completed orchestration acceptance claim. Source erasure scrubs completion prose and closes dependent plans even with flags disabled. The UI uses the existing Task/decomposition/Workflow pickers, explicit outputs, joins, limits and control rationale.

Verification: thirteen new migrated-PostgreSQL cases and nine existing Runtime Fabric/Context cases pass together. The two UI cases verify simple shape/version binding and material exact-action binding. Seventeen Learning regression cases pass in the four-file run; its initial erasure fixture omitted the required observation timestamp and was corrected before rerunning the complete orchestration selection. Thirteen orchestration plus nineteen native input/provider-capacity regression cases also pass together after the strict-wire projection fix. Shared/server/UI types, migration safety, module boundaries and token gates are checked on this slice. Final repository-wide checks and live provider/customer acceptance remain open.


## Wave 8 deterministic supervision and durable control

The existing execution reconciliation sweep observes bounded canonical tool receipts, saved output hashes, current initiating/worker authority, provider conformance and action-specific Readiness. Repeated identical failures, configured lack of progress, cumulative check/deadline exhaustion and authority/readiness drift feed a deterministic policy. Existing authoritative human waits remain distinct from missing progress. A successful provider run is only possible completion. No hidden reasoning or raw provider error content is retained in signals.

Pause/Stop fence the plan before a durable, leased intervention runs the existing qualified heartbeat/Workflow cancellation engine. The same outbox is committed atomically for human controls, so an interrupted API request cannot lose physical cancellation. Safety recovery survives rollout rollback and initiating-user revocation. Expired leases recover under skip-locked claims; failure remains visible and fenced. Retry uses the canonical queue and admission budgets; reassignment uses the canonical Task service only after pause and physical ownership release. Live steering remains unqualified and resolves to an attributed pause for guidance. Adding workers requires a newly accepted bounded plan. Verification requests remain blocked until Wave 9 supplies their qualified consumer; neither FINISH nor a worker narrative certifies completion.

Signals and interventions are company/plan scoped, attributed, hash-bound and visible through the plan API/UI. Referenced signals must match the current observed snapshot. Checks cannot reset across resume/session replacement. Database guards enforce policy/principal pins, monotonic counters, approved material-tool dispatch, unchanged live Task topology, session/decision pins and flag-independent erasure of intervention prose. Unconfirmed Stop blocks resume.

Verification: 21 migrated-PostgreSQL orchestration/supervision cases, seven pure arbiter cases and two UI cases pass (30 total). These include authority-revocation Stop, repeated real receipt failures, human-wait precedence, cumulative checks, crash/expired-lease recovery, concurrent controller claims, canonical reassignment, approval enforcement and self-certification denial. Server/UI types, migration safety, module boundaries and token gates pass. Semantic evaluator/verifier consumers and final repository-wide/live acceptance continue in the remaining waves.


## Wave 9 accountable semantic review and verified joins

Verification packets bind the current completion contract, saved output bodies and canonical revisions, declared output schemas, successful exact-arguments/approval receipts, surviving qualified Memory versions and actual worker/Workflow attempts. Stale hashes, incomplete joins, live/unsuccessful attempts, invalid schemas, missing business/evidence/prohibited-outcome judgments and material uncertainty cannot pass. An actual company administrator signs independent semantic judgments; agents cannot use the endpoint to grade their own output. High-impact completion requires explicit approval, and C4 stays closed pending a domain overlay. Human review is not counted or reported as an automated model invocation.

Passing receipts atomically update the existing canonical worker/Task lifecycle, release explicit joins and eventually complete the coordinator Task. Database guards require current independent receipts before worker/plan completion, preserve immutable decision history and prevent changing/removing verified output/revision/receipt inputs while a dependent plan remains live. Erasure clears review prose and uncertainties with flags disabled, and restored payloads remain scrubbed. History listings return content-free receipt metadata; no provider reasoning is retained.

A human trajectory reviewer can assess observed artifacts, flag off-track work and propose possible completion. Off-track evidence resolves to an attributed pause for guidance, followed by durable qualified Stop; possible completion cannot certify work. Recommendation and actual decision remain distinct. Requesting verification creates a real native human-only Task interaction with a current result hash and no automatic continuation; acknowledging it does not approve the contract. The UI presents output/source links and separate unchecked judgments, evidence choices, uncertainty, verdict and high-impact acknowledgement.

At the original Wave 9 checkpoint, the automatic read-only semantic evaluator/verifier adapter remained unimplemented. The later qualified read-only verification and automatic trajectory sections below record its implementation and local tests. Live provider/calibration qualification remains required; the human consumer keeps material semantic completion governed.

Verification: 29 migrated-PostgreSQL orchestration/supervision/verification cases, seven deterministic policy cases and three UI cases pass (39 total). Nine existing Context/Runtime Fabric regressions also pass. Golden outcomes include schema failure, failed invariants, changed outputs, incomplete joins, exact side-effect evidence, high-impact approval, worker self-certification denial, off-track intervention, canonical human review requests and flag-independent erasure/restore. Migration/module/token gates and server/UI types are checked on this slice. Final repository-wide and real provider/customer qualification remain separate.


## Wave 10 source-bound Work Signals

An actual live native Task worker can extract bounded coordination candidates from its accepted Slack delivery. The existing Slack authority resolver and governed tool gateway reread that exact participant message and channel; no alternative credential path or transcript store is added. The company, endpoint, original principal, current linked user, run, source revision, content/visibility hash, purpose and actual read invocation remain pinned. Signal text cannot grant authority. Local extraction recognizes eleven participant-claim types conservatively; ambiguous or relative dates abstain. This is not qualification of a general semantic model.

Only the original linked participant with current Task access can review these candidates. The participant explicitly selects an existing, authorized project Task for a shared-source calendar date. Apply creates a canonical pending Roadmap proposal as a human actor. The existing planning review must reread the current source and pin source/identity locks before committing a date. Restricted sources use source-scoped review. Completion, ownership, approvals and other material claims do not silently change canonical truth.

Follow-up reuses native human-only Task interactions with no execution continuation or direct Slack sends. A recorded human review request is delivered through the existing reconciliation loop, with a recoverable lease, a cumulative three-attempt limit, current access checks and canonical card idempotency. Pending follow-ups are suppressed per Task; ignored or withdrawn sources close their cards, including late recreated cards. No separate reminder scheduler or permanent privileged chat agent is introduced.

Flag-independent PostgreSQL guards scrub candidate facts and stale pending Roadmap patches on native edit/delete, original-source redaction, identity/connection revocation and retention expiry. Tombstones and immutable source pins block restoration. A human-accepted planning decision remains its own canonical business record; withdrawing a source does not silently undo an approved commitment.

Verification: twelve migrated-PostgreSQL candidate/recovery tests, three interpreter tests and one UI test pass. Existing Slack access/search and V5 project controls bring the combined run to 44 passing tests. Two selected native Slack provenance/Routine tests also pass; these are local fixtures, not connected-customer evidence. Shared build, server/UI TypeScript, migration safety, module boundaries and token gates pass in this slice. Default-off gates remain closed.

Qualification limits: current extraction/review uses the original owned native run; a finished or replaced source run requires fresh extraction through an accepted Task continuation. General semantic interpretation, autonomous follow-up prioritization and a connected Slack pilot are not established by these fixtures. Other candidate types enter human review instead of unqualified domain mutations.


## Wave 11 — backend-independent execution policy (2026-10-05)

Added a narrow ExecutionSandboxBackend contract, explicit capability semantics and a deterministic policy subset compiler. Policies constrain filesystem paths, exact binaries/syscalls, network host/port/method/path authority, current credential grant hashes and resource limits. Missing, expired, best-effort or locally simulated enforcement cannot earn managed assurance. C4 remains closed pending a qualified domain overlay. The structural compiler result is distinct from a physical enforcement observation.

Bindings pin an existing stopped V6 runtime cell generation and immutable maximum boundary. Compilation requires an actual owned native execution manifest, current human/worker Task access, exact qualified provider configuration/profile, the cell's actual presence binding, native capacity limits and the original execution/plan deadline. Connection inventory cannot mint broker credentials. Qualification runs positive and negative probes through the registered backend; unsupported tests or observations without hashes remain inconclusive. The V6 compatibility adapter preserves canonical inspection/Stop/delete and explicitly refuses fine-grained V7 workload admission.

Company-scoped operator APIs expose qualification, policy history and reconciliation. Customer runtime UI shows minimal posture, without claiming compilation or backend qualification means an enforced workload. Database guards preserve immutable boundaries, reports and policy snapshots; generation/image/credential/provider changes quarantine bindings and revoke policies independently of feature flags. Native start/upgrade/restore/migrate on a V7-bound cell is blocked until the Wave 12 applied-boundary admission path is implemented; ordinary unbound V6 cells retain their existing lifecycle. Stop remains available.

Verification: 32 server tests (policy matrix, migrated PostgreSQL and existing V6 recovery) and six UI tests pass. Shared build, server/UI TypeScript, migration safety, module boundaries and token gates pass. No actual OpenShell host qualification or managed workload safety is asserted by these local fixtures. Reconciliation is operator-triggered in this slice; automatic host reconciliation, signed applied-policy evidence and durable broker revocation are Wave 12 work.


## Wave 12 — OpenShell integration in progress (2026-10-05)

Revalidated OpenShell v0.1.2, Apache-2.0, source commit `6648bd0c290efbc41ba131ee9831ee45cd431f94`. Downloaded official CLI/prover archives with GitHub's SHA-256 digests verified before extraction. The prover executable itself is pinned by SHA and invoked with fixed arguments, a bounded solver/process deadline, sanitized environment and private temporary policy files. Stored evidence omits counterexample prose and temporary paths. Actual boundary proofs retain both coverage and unsupported path-resolution semantics.

Added a conservative OpenShell authored-policy projection and backend adapter. Filesystem enforcement requests `hard_requirement`; implicit workdir expansion is disabled. REST path prefixes project exact paths and segment descendants without sibling widening. Network binary selectors are explicitly not treated as process-execution allowlists. Custom syscall allowlists, deny holes below filesystem allowlists, native credential projection and complete high-assurance coverage remain unsupported by this adapter. No raw provider credentials are passed through the CLI.

The adapter requires exact scoped identity/image/version, fresh capability qualification, unchanged maximum boundary, observed applied-policy hash and a fresh proof of the composed effective policy before start. Static changes require recreation. Unexpected effective authority triggers provider revocation plus native Stop. Failed revocation still requests native Stop and reports the actual operation ID. Fixture provenance cannot silently become protected-host evidence.

Local verification: 13 tests pass, including four actual pinned-prover checks and six adapter tests with local host-protocol fixtures; server TypeScript passes. Developer-host and Docker ABI probes (both default seccomp and an unconfined trusted probe, without network or credentials) return Landlock `ENOSYS`. This is measured local NO-GO evidence, not a production result. See `doc/operations/aw-v7-evidence/openshell-local-boundary-2026-10-05.json`.

**Still open:** production native-host bridge/registration, broker projection and revocation delivery, actual OpenClaw/Hermes compatibility, resource/network/secret-leakage/Stop probes, backup/restore/upgrade/host-loss and canary evidence. OpenShell remains uninstalled in the production backend registry, default-off flags remain off, and V7-bound native admission remains closed. This slice does not meet the Wave 12 physical-enforcement exit criterion. Wave 13 registry work can proceed independently while those gates remain explicit.

## Wave 13 — intended-purpose governance and execution control (2026-10-05)

Added company-scoped use cases with immutable purpose versions, accountable owners, explicit value-chain facts, affected people/data categories, prohibited uses and purpose-specific review dates. Human oversight profiles and assessments are immutable records. Approval requires current human reviews of the exact purpose for EU AI Act, GDPR and company policy. The generic runtime keeps specialized people inference/decision domains and C4 closed; recording a classification does not certify a specialized deployment or legal compliance.

Native Task deployment bindings pin the reviewed purpose and actual authority. Current checks cover agent/provider configuration, permissions, model/image/generation, sandbox boundary, Foundation authority pointers, Role Pack/Skill/Playbook versions, connection configuration and reviewed obligation sources. Changes close execution and create explicit reassessment history. Organization overlays conservatively invalidate company deployments. C2/C3 bindings require actual independent orchestration; execution requires its actual running worker attempt. Material catalog actions retain a human decision requirement even when ordinary tool policy allows them.

Every governed native run pins its deployment at durable queue admission. New approval cannot revive an old run, copied context cannot swap the pin, and a retry cannot inherit a changed purpose. Existing sessions are checked again through canonical mutation and tool gateway paths. Suspension, stale authority and feature rollback fence late work independently of admission flags. Durable leased Stop delivery uses the existing heartbeat cancellation controller, preserves cumulative retry limits and never fabricates a physically stopped workload. Binding a purpose to an already-running legacy session requests native cancellation before admitting fresh governed work.

Added an immutable obligation registry with source/version/applicability facts, explicit superseding reviews, review dates and uncertain/overdue execution closure. Generated JSON evidence packs project current authorized Task deployments, purpose/assessment/oversight history, provider/model/runtime boundary metadata, readiness observations, obligation records and native audit references. Exports have a deterministic hash and a consistent read snapshot; they are explicitly bounded and omit private Memory, raw source bodies, credentials and connection configuration. Package qualifications, subprocessor contracts and physical host qualification remain independent evidence requirements. The native company UI supports purpose registration/revision, human assessments, activation bindings, suspension/retirement, obligation reviews and evidence export; account identity scopes both reads and writes.

Local verification: **68 server tests pass** (21 governance policy/PostgreSQL tests plus 47 existing tool-policy and Work Signals regressions); **one governance UI test passes**. Shared build, server/UI TypeScript, migration numbering/safety, module boundaries and token gates pass. The OpenShell candidate-boundary correction has **14 actual-prover/adapter tests passing**. These are local results, not production acceptance or legal qualification. Full repository verification belongs to Wave 19.


## Wave 14 — Free Core and bounded paid capacity (2026-10-05)

The native V6 entitlement resolver supplies a permanent no-card Free baseline without manufacturing subscriptions, customer IDs or checkout prices. Core knowledge, Work, governance, audit, privacy/export and BYO operation remain available; paid managed infrastructure stays separate. Versioned launch-policy limits currently grant 1 GiB of account storage and two concurrent native runs. These are explicit rollout policy values, not validated unit economics or a promise of unlimited model/physical runtime consumption. Existing product/price identities and historical snapshots retain their catalog versions. Disabled or suspended billing accounts cannot acquire the Free baseline.

Running admission uses a PostgreSQL advisory lock across controllers, a fresh native entitlement snapshot and canonical running-row accounting. Excess work stays queued. Cancellation-pending native runs consume capacity until their canonical lifecycle settles. A paid downgrade leaves business state and existing storage intact while rejecting additional over-limit storage. The commercial sweep fences and pauses only agents actually bound to affected managed cells, requests native Stop through the existing controller, and retries failed cancellation delivery. Other BYO agents continue. Canonical mutations and both stored/regular tool gateway contexts recheck current managed commercial authority and requested cancellation before late writes. No database observation is claimed as a physically stopped host.

Verification: **61 server tests and one billing UI test pass**, covering no-card native onboarding, concurrent admission, paid-to-Free downgrade, over-limit storage preservation, managed cancellation failure/retry, BYO continuation, suspended accounts and existing tool-policy/governance regressions. Shared/DB build, server/UI TypeScript, migration safety, module boundaries and token gates pass. One older commercial test now uses the actual current clock for its relative expiry fixture. Full repository, live provider and launch-economics acceptance remain Wave 19 gates.


## Wave 15 — native Agent Package distribution and activation (2026-10-05)

Global first-party release metadata carries immutable versions, content/component digests, intended purpose, declared limits, compatibility, license/provenance and distinct release-evidence dimensions. Configured platform publishers alone publish/revoke current-build protected artifact references. The shipped shared internal source-review distribution uses typed native policies and remains an explicitly internal evaluation; no customer or host qualification is synthesized. Customer releases require independent supply-chain/evaluation records and a maintained capability product.

Company installation resolves exact authorized native Role Pack/Skill/Playbook/Workflow/Routine versions, configures the selected direct Role Pack and creates no permission, connection grant, payment subscription or provider identity. Readiness preview and activation reuse the native engine, including package-specific knowledge criteria, current worker/original-human access, actual provider conformance, purpose and optional/required connection checks. Native Role Pack preview replaces the direct assignment while preserving system/organization overlays. Customer activation requires a current approved intended purpose; actual Task work requires its deployed governance binding. Managed assurance remains blocked without qualified physical enforcement.

Native run admission pins the exact installation and activation revision. Suspended/revoked/changed/expired authority and rollout rollback fence late writes/tools; a new activation cannot revive an earlier run. Durable Stop retains a bounded recoverable lease and cumulative delivery budget. Material updates require explicit human review and separate activation. Learning proposes company-local updates to existing published releases, retains current outcome/Memory lineage on human acceptance, and scrubs proposal prose/blocks restored payloads independently of feature flags. Uninstall preserves company business state, native agents and knowledge. Three stable maintained-package products extend the existing billing catalog; model/runtime consumption is separate from capability subscription and authorization.

Verification: **81 combined server tests pass**, including twelve package PostgreSQL cases and existing Learning, governance, Free Core and tool-policy regressions. **47 targeted package/tool-policy tests pass after the final native resolver and deny-priority changes**, and **four affected UI tests pass**. Shared/DB build, server/UI TypeScript, migration safety, module boundaries and token gates pass. The internal package checks are local protocol fixtures, not representative customer business-output, model-portability, cost/latency or physical-host evidence. Stored `auto_low_risk` company policy receives its bounded consumer in Wave 17. See `doc/operations/agent-packages/v7-internal-evaluation.md` and the dated Agent Package ADR.


## Waves 16–17 — specialists and native stewardship (2026-10-05)

Chief of Staff, Growth and Research are explicit draft candidates with three representative case contracts each. They reuse native Role Packs, Skills, Playbooks, completion contracts, successful package-pinned runs and independent verification receipts. No package is published, hired or claimed as a qualified customer specialist from a template. Growth/Research contracts preserve the uploaded validation doctrine: observed behavior, predeclared denominators and thresholds, explicit uncertainty and source provenance. Source filenames are reference assets, not assumed redistribution licenses. Missing company knowledge lowers draft specificity; side effects remain closed until a native semantic action classification is qualified.

Customer release evidence now separates observed customer demand from evaluation, protected holdout, supply chain and sandbox evidence. The native PostgreSQL release gate checks expiry, future-dated evaluation, critical findings and required independent evidence dimensions. The evaluation API rebuilds current authorized native verification packets, requires declared case contracts and exact successful package activation pins, and exports a hashed metadata report without source bodies or new completion authority. It explicitly cannot establish customer demand, holdout representativeness, portability, cost or physical enforcement.

Core Stewards extend the existing execution-control loop. Latest native Readiness assessments that expire or lose their approved Foundation source receive bounded, idempotent metadata findings. Existing Memory privacy/retention jobs, governance fences/Stops and supervision/follow-up consumers remain the canonical maintenance mechanisms. A company can explicitly opt into automatic unchanged-content updates. The consumer checks current original-human authorization, native component pins, semver advancement, release qualification and absence of live native work. It changes only the installed version and requires fresh activation; material changes remain human-reviewed proposals. Audit actors remain system with the policy owner identified separately. Readiness surfaces current principal-owned quality findings.

Verification: 22 focused package/specialist server tests pass, and 27 tests pass with native Readiness regressions. A further 41 specialist/tool-policy tests pass; three package/governance UI tests pass. Shared/DB build, server/UI TypeScript, migration safety, module boundaries and token gates pass. The repository lockfile also required reconciliation with dependencies already declared in the baseline; the declared pnpm 9 toolchain is restored before the full checks. Actual customer-demand and representative live-work qualification remain open; no Wave 16 launch exit is claimed.


## Wave 18 — native enterprise identity, delivery and portability (2026-10-05)

Pinned Better Auth SSO/SCIM plugins retain native global authentication and company authorization. Exact verified subject bindings, no implicit JIT/email linking/group grants, native policy/CAS/key/certificate guards, qualification expiry and company-only lifecycle projection apply. A narrow pinned SDK patch prevents SCIM deactivation from deleting unrelated global sessions. The owner UI uses actual member and encrypted-secret selectors, one-time credential display without mutation-cache token storage, explicit provider selection, terminal mapping withdrawal and company-scoped decommissioning. OIDC qualification parses the actual encrypted RSA key (at least 2048 bits), and rotation invalidates the prior version/digest qualification. The SaaS login screen exposes the native qualified SSO path; forged/unissued SAML callbacks do not create sessions.

The default-off security-event adapter derives deliveries atomically from the existing company activity log. It signs schema-versioned minimal envelopes, retains stable dedup identity, checks current owner/configuration/key authority, uses the existing DNS-pinned public transport and bounds requests, retries, leases, backlog and retention. The owner sees pending/delivered/failed/cancelled counts and backlog omissions. No webhook is configured or delivered to an external customer during workspace verification.

The existing company archive supports an explicit V7-state extension; a native authenticated standalone JSON download is also available. It exports shared Memory/lifecycle/evidence, all eligible observations/models, Foundation/knowledge, Playbooks, Role Packs, Workflows, package references and governance/audit metadata under current owner authority. Privacy locking and source/retained-asset erasure checks prevent deleted or private payload export. Credentials are redacted, the files map is hashed, and neither feature rollback nor paid entitlements blocks owner portability. An account change suppresses a pending UI download. The export extension does not silently import old authority into a live deployment.

Verification: eighteen new native/bridge/schema tests are covered by the focused suites (the final decommission subset is twelve tests); sixty-four affected UI tests pass. The actual SAML start/forged callback, encrypted RSA qualification/rotation, SCIM company projection/decommissioning, transactional signed outbox/retry limits and 101-observation erasure/rollback export use local fixtures. Existing authentication/credential and portability suites were checked; four old export-route option assertions were preserved by passing the native actor only for explicitly requested V7-state exports, and the sixty-test route/auth regression run passes. Shared/DB builds, server/UI TypeScript, module boundaries, migration safety and token gates are checked before commit. Repository-wide acceptance follows in Wave 19; no CI, live IdP, customer receiver, legal/physical or enterprise GA pass is asserted.

## Wave 19 — local compound hardening and explicit pilot blockers

The native execution-control sweep now runs a bounded sandbox guardian independently of rollout and original-user membership. It quarantines changed or lost qualification, revokes policy snapshots and submits a generation-bound, system-attributed Stop through the existing runtime operation engine. Failed or terminal-failed Stop remains visible as pending. The dispatch consumer cancels a stale-generation safety operation without mutating the replacement cell. No accepted request is described as physical termination. Current V7-bound workload admission remains closed, so a live bound cell is treated as a lifecycle bypass.

Qualification rereads attestation after its eighteen actual backend probes and retains the original expiry ceiling. Expiry or image/kernel/credential-epoch/control drift during probes is inconclusive. The hash binds both snapshots, status and exceptions. Migration 0378 extends flag-independent invalidation to model ID, resource profile, runtime provider, isolation, host placement, gateway-reference and host credential/liveness changes. It preserves immutable qualification history and native cell generation.

The compound native tests combine package update/model change/stale Foundation, copied apparent output/source erasure/owner revocation/rollout rollback, and paid downgrade/native Foundation/shared Memory/owner export. The Foundation test explicitly grants the native agent membership and source permission; package installation still grants neither. The existing PostgreSQL constraints, Stewards, package reconciliation, native Stop and export services perform the transitions. Local callback fixtures are not physical cancellation or live-customer evidence.

The checked-in `evals/aw-v7/pilot-readiness.json` and read-only checker cover all fourteen journey steps, nine fault classes, three compound cases and nine operating evidence groups. The checker rejects fixture, wrong-scope/revision, expired/future, duplicate and credential-bearing references. It also reports four incomplete code paths even when external metadata claims all passes: native OpenShell host bridge/registration, credential-use broker/revocation, pre-spend model reservation, and automatic read-only semantic consumer. These are implementation gaps, not merely missing operational paperwork. Reference validation cannot authenticate artifact bytes or qualify GA. See `doc/operations/aw-v7-integrated-pilot-readiness.md`.

Repository-wide typecheck and build passed at the pre-hardening checkpoint after `15cee365b`; they are not a final unchanged-revision acceptance claim. The complete repository test run is still in progress. The final eight-suite hardening/runtime selection passes all 87 tests, with the actual pinned OpenShell prover configured. Final affected server types, DB build, migration numbering/safety, module boundaries and token gates pass; the pilot-checker negative tests also pass. The whole build brief remains incomplete until its missing code paths and actual integrated pilot are completed; no staging, provider, customer, legal, production or CI pass is fabricated.

See `doc/operations/enterprise/v7-identity-security-export-portability.md` and the dated enterprise ADR. Actual customer-specific identity/lifecycle needs, dedicated placement, contracted residency/retention, supplier facts, AW-as-provider NIS2 applicability, procurement and exit rehearsals remain independent operating evidence requirements.

## Native OpenShell host integration after Wave 19 hardening

The SaaS backend now registers the OpenShell adapter with an operator-pinned prover and the existing signed/encrypted native host protocol. Host-agent 6.0.1 polls a separate command type in `runtime_host_commands`; the original runtime claim consumer excludes it. A private pinned CLI controller observes only exact company/binding/cell/generation labels in an explicit gateway/workspace, performs scoped Stop, bounded provider detach and deletion, and journals restart receipts. Host-loss fencing attempts both engines independently. Current native company permission, flags, host epoch/liveness, image configuration and generation are checked at enqueue, non-safety consumption and completion. Queue capacity, leases, retries and deadline are bounded; native audit events preserve system host attribution.

The final native PostgreSQL/host-auth/sandbox selection passes 27 tests. CLI fixture tests pass six cases, with a further seven existing engine/backup cases passing. The separate physical kernel network acceptance test fails its root prerequisite on this UID-1000 workspace; no firewall/isolation pass is claimed or weakened. Shared build, final affected server types, module boundary and pilot-checker negative gates pass. The actual SaaS deployment/native command-recovery regression selection passes 33 tests. The original full repository run continues across changing source and cannot serve as an unchanged final-revision acceptance claim.

This closes backend registration and authenticated host transport, not physical workload admission. The actual CLI does not expose an independently observed image digest or the full AW outer resource/process/credential boundary. The controller therefore returns null capabilities and unsupported probes. Inconclusive qualification is now retained without fabricating preparation from a configured image. Native prepare/apply/start, credential-use broker, pre-spend model reservation and automated semantic consumer remain implementation work. The OpenShell blocker remains in the integrated manifest. See `doc/operations/aw-v7-native-openshell-host-control.md` for the concrete protocol and configuration.

## Native pre-spend reservation primitive

The existing Orchestration Plan now has a native company/plan-scoped reservation ledger, finite model/tariff/token envelope, exact integer ceiling and a single-use dispatch claim. Migration 0379 serializes concurrent admissions and atomically charges the existing plan counter from immutable reservations; direct counter decrement, ledger deletion and dispatch retry are rejected. Unknown dispatch and expired preflight retain the full conservative debit. Current original user, Task permission, rollout, source hash, tariff/deployment revision and deadline are rechecked before dispatch. Provider transport success is not Task completion. No plaintext prompt, provider response body, secret or error body is retained.

Seven quote/native PostgreSQL cases pass. The existing thirty-case orchestration selection passes with the new migration; the seven final reservation tests also pass with the corrected 21-test startup scheduling suite. Final affected server types and DB/migration safety build pass. Pricing and current-authority callbacks in these tests are explicit private fixtures, not live price or provider qualification. Actual SDK/token bounds, credential-use broker, worker gateway admission and automatic semantic consumer remain implementation work. The model-cost blocker remains open. See `doc/operations/aw-v7-native-model-reservations.md`.

The first full `pnpm test:run` completed its general-server stage with 14,814 tests passing across 798 passing suites, six skipped suites and one failed startup suite. The startup suite's minimal DB mock was corrected to retain native schema exports and isolate V7 services; it now passes 21 tests and checks the safety sweep at startup and on the interval. The separate workspace run exposed an obsolete fixed feature-count assertion after adding security export; its default-off contract now explicitly covers that gate, and the full 840-test shared suite passes. The UI and CLI workspace stages pass 6,803 and 502 tests respectively. The historical V5 fixture now restores its actual provenance expansion before later manifest references; it and the regenerated schema snapshot pass. The failed cross-tenant route suite passes all thirteen tests in isolation after the first attempt timed out during module loading. The serialized stage is being repeated with lower resource contention; remaining workspace stages are in progress. This is not yet a passing full command on an unchanged final revision.

The reservation migration snapshot was regenerated from the compiled schema through Drizzle, retaining custom SQL guards separately. The regenerated reservation/startup/orchestration selection passes 58 tests across three suites; the affected server TypeScript check passes. No capped worker admission is opened by this primitive.

## Qualified read-only model verification consumer

The native leased START_VERIFIER consumer now optionally performs one server-side, text-only Anthropic Messages call with a private deployment-pinned company profile. Existing AI Connection grants, encrypted native secrets, current initiating human, reviewer presence, exact deployment/source qualification, authorized Task documents and nonsensitive shared Memory determine admission. The actual transport fixes HTTPS destination, method, API contract and standard service tier, exposes no tools or streaming channel, refuses redirects, bounds the complete request/response and deadline, and performs no automatic resend. Credentials remain server-side. Missing or expired qualification leaves the provider unused and requests human resolution.

Migration 0380 links model assessments to a completed, single-use native reservation and forbids model pass/approval. Read-only calls share the existing finite verifier count and conservative model-cost debit; worker spend still requires an explicit cost cap. Reservation expiry runs independently of configured profiles and feature rollback. Source, membership, account, credential and rollout authority are rechecked before/during/after dispatch. Revocation and ambiguous results retain the debit, pause the native plan and enqueue current generation-bound Stop. Delivery is not physical cancellation proof. Even a positive semantic assessment over passing deterministic checks becomes `needs_human`; it never completes the Task or preselects the human review checkboxes.

The final seven-suite reservation/transport/profile/native verifier/orchestration/config/startup selection passes all 115 tests. Eleven actual PostgreSQL verifier cases include concurrency, positive deterministic evidence requiring human review, source and member revocation, exhausted call budgets, expired qualification, native queue delivery and no replayed spend. The UI review test passes; affected server types, DB build and regenerated snapshot/historical migration fixtures pass. Provider responses, profiles, prices and calibration in these tests are explicit private fixtures. No live Anthropic account, current vendor tariff, calibration artifact bytes, customer pilot or physical sandbox is qualified by these local tests.

Automatic semantic trajectory review, worker model gateway and the complete physical OpenShell prepare/apply/start and credential-use boundary remain implementation work. The integrated pilot manifest stays incomplete. See `doc/operations/aw-v7-read-only-model-consumer.md`.

## V7 API contract coverage correction

The broad serialized regression stage found eleven mounted V7 route files absent from the OpenAPI coverage catalogue, plus the new sandbox host claim/completion operations. An explicit V7 operation catalogue now reuses the handlers' shared request validators and documents native company authority, human review, configured operator/publisher/owner restrictions and exact host-signature headers. Bounded handler loops are expanded per enclosing loop, so every preview/install, activate/suspend, derived review and governance decision is compared separately. No route is excluded to make coverage pass. The fifteen-test OpenAPI suite now passes, including exact mounted-route parity, strict review/version/host completion contracts and separate board/host authorization; the affected server TypeScript check passes.

## Automatic qualified semantic trajectory consumer

The existing supervision interval now queues newly observed saved work in its existing leased intervention outbox when deterministic arbitration permits running work. Company profiles must explicitly qualify the trajectory purpose; existing verification-only configuration does not activate it. The queue pins the current native plan version and authorized result packet, bounds pending checkpoints by the remaining assessment allowance, and retains a stable spend identity across retries. Expired or changed checkpoints, unavailable profiles and ambiguous responses fence the plan and enqueue native Stop independently of the original user's ability to request it.

The same text-only provider transport, encrypted AI grant authority and atomic reservation primitive perform trajectory assessment. The existing deterministic arbiter owns the effect: on-track observations grant no continuation; wrong-objective or uncertain work requires native pause/human resolution; possible completion needs passing native postconditions, zero live attempts, remaining depth and a separate verifier call. Migration 0381 links immutable model trajectory signals to completed native trajectory reservations and forbids scope/spend swaps or invented certification. No model output resumes, retries, spawns, reassigns, approves or finishes work. The board exposes the existing shared assessment limit and labels model trajectory history as advisory.

The six-suite affected selection passes 93 tests, including 21 native verifier/trajectory PostgreSQL cases and the complete 30-test orchestration suite. A separate SaaS configuration selection passes all 32 tests, bringing this affected server check to 125 passing tests across seven suites. The three UI tests pass. The final affected server TypeScript check, DB/migration build and generated snapshot drift test pass. Local tests exercise automatic native queueing, the actual encrypted grant, a separate second reservation for verifier delivery, foreign evidence, source drift, expired checkpoints and human-only completion. Transport responses and calibration/pricing profiles remain private fixtures, not live model/host/pilot qualification.

The semantic consumer code blocker is now implemented and verified within that explicit local scope. Physical OpenShell prepare/apply/start, workload credential use and the forced worker model gateway remain code blockers; all real provider, customer, physical, legal and integrated operating evidence remains required. The workspace-B stage also passes every listed project, including all 162 DB tests; this is supplementary regression coverage across changing source, not final unchanged-revision acceptance.

The final native erasure case also passes: all 22 verifier/trajectory PostgreSQL tests now pass. Native plan erasure scrubs model trajectory criterion/source references and expires their signals while retaining the conservative financial receipt and preventing replay. The serialized continuation passes all 32 remaining suites and 403 tests after the earlier 122 passing suites. These combined runs cover the full serialized catalogue, but source changes between stages still require a final unchanged-revision command before broad hand-off.


## Private native worker model gateway (2026-10-06)

A distinct five-minute, native company/presence/run/attempt/manifest/plan-version capability now authorizes the private worker HTTP consumer. The complete text envelope is bounded; private operator profiles pin the exact installed provider/configuration, encrypted AI Connection grant, source SHA and current conservative tariff. One server-side Anthropic Messages call follows a committed single-use native reservation. Worker input cannot select destinations, model prices, credentials, tools, sessions, streaming or retries. Company/presence identity, original membership, Task ownership/source, run/write authority, Memory retention, provider and credential versions are rechecked before/during/after dispatch. Ambiguity and revocation retain the debit and fence through the native supervision outbox. The actual HTTP route rejects board/agent/tool credentials and browser origins/cookies, and documents its separate capability in OpenAPI.

The final three-suite worker/native HTTP/OpenAPI/startup selection passes all 60 tests, including 24 migrated-PostgreSQL gateway cases. The profile/configuration/reservation selection passes 42 tests across three suites. Existing read-only consumer/profile/transport regressions pass 36 tests; the corrected OpenAPI suite passes all 15 cases. Shared build, final affected server TypeScript, module boundaries, token gates and all three pilot-checker negative cases pass. Profile, price and provider responses are private fixtures; no live qualification is asserted.

This implements the server inference boundary, not forced worker launch. Capped plan start/admission remains closed until the actual runner is restricted to this transport. Managed OpenShell bindings, autonomous CLIs and managed sessions are explicitly rejected by this consumer. Physical OpenShell prepare/apply/start, per-use credential qualification and actual integrated operating evidence remain required. Before this gateway change, the full repository typecheck and build passed at commit 148f98673; these are not final unchanged-revision acceptance for subsequent work. See `doc/operations/aw-v7-worker-model-gateway.md`.

## Native Task tool budget boundary (2026-10-06)

The native Task authority and older semantic authority now enter the existing tool invocation ledger before executing plan-bound reads or low-risk draft bookkeeping. The PostgreSQL guard charges the original plan counter atomically. Declared output keys, original human, current company/presence, admitted attempt/manifest, Task ownership, provider conformance, retained Memory, accepted topology, rollout and original deadline remain mandatory. Draft mutations repeat the check inside their existing transaction using Memory, plan, Task and run lock order. General API and unclassified material paths are closed for these draft plans. Assigned MCP execution retains its actual gateway ledger and approval boundary without double charging; catalog search receives its own native debit.

The final four-suite selection passes all 94 tests: 38 native PostgreSQL gateway/tool cases, 22 ordinary native Task-authority cases, 30 orchestration cases and four native PRP coordinator cases. It covers actual Task handlers, both protocol paths, concurrent/replayed calls, revocation, ambiguous effects and assigned-MCP accounting through the real SQL budget guard. The assigned gateway response, provider responses and model qualifications are explicit private fixtures. Final affected server types, module boundaries, token gates and the three pilot-checker negative cases pass. Tool receipts retain hashes and fixed error codes; unknown effects retain their debit, pause and request native Stop. Neither tool success nor requested Stop certifies work or physical termination.

Forced worker model launch and physical OpenShell admission/credential use remain incomplete and closed. The full repository test command continues across changing source and cannot serve as final unchanged-revision acceptance. See `doc/operations/aw-v7-native-task-tool-budgets.md`.

## Private Native one-call draft session backend (2026-10-06)

The controller-only `aw-text-draft-v1` backend now implements the existing Native Session contract with one metered Task read, one reserved server-side model call and one canonical declared-output write. Exact session/worker binding, current contract and optimistic document revision prevent redirection or blind overwrite. Its actual control-plane events and retained result propose human review with unknown criteria; they neither store model bodies nor certify completion. Automatic continuation, reopening, recovery and replacement are closed. Cancellation synchronously revokes local turn authority and settles pending iterators; Native Task mutations check that controller signal under their existing locks and before committing their receipt. The gateway's private failure path fences the exact native attempt independently of original-user access or capability expiry, including an empty otherwise financially completed model response.

The final two-suite selection passes all 68 tests: 46 native PostgreSQL gateway/tool/session cases and 22 ordinary Native Task-authority regressions. Eight session cases use the actual encrypted grant, native financial/tool guards and Task document handler with private provider responses. A PostgreSQL fixture assertion now selects the dispatched receipt explicitly instead of assuming heap/insertion order after updates. Final affected server types pass. This is a private backend checkpoint, not forced production launch: explicit provider identity, bounded runtime-context realization and actual heartbeat/start/admission binding remain implementation work. The pilot's model-spend code blocker remains incomplete, as do physical OpenShell and per-use credentials. See `doc/operations/aw-v7-native-text-draft-backend.md`.


## Forced Native draft provider and heartbeat (2026-10-06)

The explicit `aw_text_only` provider now selects `aw_text_messages` through the actual Native heartbeat. SaaS startup privately registers the existing budget gateway against its real database. Plan start and each Native admission check the original human, current canonical worker/contract, exact private model profile and remaining model/tool ceilings. A CLI or runtime AI binding cannot replace the private grant. The package backend rejects this provider rather than falling back to a CLI; the heartbeat ignores its ordinary injected backend seam for internal drafts. Runnerd, managed GitHub/session continuity and recovery remain outside this provider path.

The factory verifies its running Native session, admitted worker/attempt/manifest, original human and contract. It projects bounded, manifest/hash-verified, UTF-8 instruction and assigned Skill text from the existing immutable Native asset cache. Raw MCP, arbitrary roots, symlinks, changed bytes and oversized bundles are rejected before inference. The draft driver has a separate server-selected control-plane event stream so Native coordinator events keep their own sequence. Actual Native finalization proposes human review and preserves server completion authority. Static provider discovery advertises the actual fresh contract without fabricating qualification; ordinary provider probes reject the draft transport. Production still needs real retained conformance and protected operator model qualification.

The final six-suite server acceptance passes all 154 tests: Native worker gateway/forced heartbeat, orchestration, ordinary Task authority, runtime assets, runtime selection and native provider conformance. The new actual heartbeat tests create/start a fresh plan and let the scheduler admit its attempt; they do not manually insert or mark that attempt as running. They prove one inference, a saved canonical output, financial/tool accounting, refusal of backend substitution, revocation before admission and human Pause during inference without publication or automatic resend. Provider responses and conformance/pricing remain explicit private fixtures. The two package input/factory suites pass all 39 cases. Server and UI typechecks, module boundaries, token gates and all three pilot checker negative cases pass.

This completes forced launch for the bounded standard C0/C1 internal-draft scope. It does not implement forced pre-spend transport for managed autonomous CLIs/sessions, physical OpenShell admission or per-use workload credentials. Those broader managed-runtime implementation blockers and the live integrated pilot remain incomplete. See `doc/operations/aw-v7-native-draft-launch.md`.

The earlier broad repository test command finished with 15,141 passing tests and 14 failures across four files. It ran across changing sources and used earlier built runner modules while newer test cases were loaded; focused acceptance with current built modules passes those affected boundaries. That command is not a final-revision acceptance pass. A new unchanged-revision full verification is required before a PR-ready claim.


## 2026-10-06 — OpenShell immutable instance pinning

The native host controller now persists the actual OpenShell gateway sandbox UUID before its first effect and checks it against the immutable AW company/binding/cell/generation scope on subsequent observations. Provider detach rechecks that identity before each effect and after completion. Stop observation and host-loss fencing retain the same pin across restart. Legacy journal observations with no UUID remain fenced; name/labels cannot silently adopt a replacement instance. Scope storage is bounded at 256 host bindings. Destruction requires a complete bounded absence observation of both the original UUID and name.

The pinned OpenShell 0.1.2 source confirms the CLI JSON identity field and name-scoped lifecycle API. This change catches replacement drift; that API still offers no instance-ID precondition for an atomic lifecycle effect, so it does not qualify physical admission. All nine host CLI cases pass, including restart with identical labels on a new instance, missing identity and legacy journal migration. The physical prepare/apply/start, credential-use transport and broader autonomous model-spend paths remain incomplete. No mock or configured label is promoted into physical evidence.

A follow-up qualification audit confirms that ordinary Native conformance rejects `aw_text_only`. The local forced-launch tests use explicitly recorded fixture conformance. A real draft-provider bootstrap runner remains code work within the broader model transport blocker; protected live model qualification is then a separate operating gate. The acceptance manifest and launch documentation now make that distinction explicit.

The separate local host regression selection passes 16 tests. The physical firewall acceptance test fails its root prerequisite on this UID-1000 host and is not reported as a pass.

The host advertises 6.0.2. The native sandbox lane requires that version, so a pre-pinning 6.0.1 host cannot accept new commands. The server test selection covers both 6.0.0 and 6.0.1 rejection; verification of this additional server case follows the unchanged full-checkpoint run.

The isolated migrated-PostgreSQL host bridge selection passes all 10 tests on the instance-pinning branch, including rejection of both older host versions. The original full repository checkpoint remained unchanged during this selection. The 16 local host tests and the three pilot-checker negative cases also pass on that branch. The physical firewall root prerequisite and complete managed admission remain open.

The PR tree restores the master lockfile as required by `doc/DEVELOPING.md`; CI owns dependency lock regeneration. The exact locally verified 509ef7346 lock is retained outside the repository as `/workspace/aw-v7-verified-pnpm-lock-509ef7346.yaml`. Public registry metadata confirms the official MIT-licensed `@better-auth/sso` and `@better-auth/scim` 1.7.2 distributions. The V6 base is merged commit 137e6ab386d6e579e9057d2c44b583a7167dc29f; its PR #34 has 70 successful CI checks and four skipped optional checks. This is predecessor evidence, not a V7 or physical pilot claim.


## 2026-10-06 — CI dispatch regression and durable warm-attach observation

Draft PR #35 exposed an actual ordinary Native dispatch regression: asynchronous draft backend selection also invoked the ordinary injected backend factory before the atomic cancellation/chat admission gate. Ordinary factories now remain synchronous inside that existing gate; only effect-free private draft projection happens before it. The complete migrated PostgreSQL heartbeat recovery and worker gateway files pass all 362 tests, including cancellation, transient admission contention, bootstrap recovery and forced draft substitution. The affected server typecheck passes.

The Runner lost-ACK case observed `rotateRunIdentity`, although an authenticated peer may already activate the durable owner before that caller polls the command. It now observes the actual durable store commit changing identity. A deterministic late-observer case reproduced the faulty observation before the fix (two failures) and proves all original event ownership, ACK cursor and provider continuity assertions after it. All 164 cases in the full Runner transport file pass with the real previously built release Runner and fake-provider fixture binary. Local PID 1 does not reap orphaned providers; a workspace-only Linux subreaper wrapper supplies normal init reaping without relaxing process-absence assertions. An earlier incomplete binary-path run and a run without the subreaper failed and are not acceptance passes. No production Runner protocol changed for this test fix.

The unchanged 509ef7346 full command passed types, build, the general server stage (15,179 tests), UI (6,803), CLI (502), shared (840), skills (20) and DB (162). It was stopped during serialized stages because CI already proved that revision's dispatch defect. It is not a complete repository pass and does not validate these later commits. PR #35 remains draft pending current-revision CI, the remaining implementation gaps and protected integrated pilot evidence.


## 2026-10-06 — Authenticated V7 browser flow and validation/navigation repairs

The new isolated authenticated Playwright flow passes against Chromium and a freshly migrated PostgreSQL instance. It exercises browser signup, instance bootstrap, two companies, a paused local discovery presence, canonical discovery Task creation, saved human answers, blocked external-communication Readiness, creation of a human oversight profile, a draft AI use case and its downloaded governance evidence pack. It proves cross-company and outsider denial and rejects invalid feature-dependency rollback before applying a consistent rollback. It follows actual sidebar links for Readiness and AI Governance. The paused presence makes no model call, publishes no Foundation approval and earns no runtime qualification.

That browser flow found a real crash in AI Governance: a URL refinement threw on the empty obligation form. Governance, package, enterprise and security-export references now return Zod validation issues for unfinished or malformed URLs. Their existing HTTPS, credential, query and fragment restrictions remain enforced. Ten shared reference cases pass, the four initial shared/UI selections pass 14 cases, and four migrated PostgreSQL domain files pass 32 cases. The final shared rerun includes enterprise and security-export assertions.

The browser snapshot also exposed missing company route roots: Readiness, Orchestration, AI Governance and Work Signals links were interpreted as company prefixes. They now use the active company, preserve another explicit company prefix and keep query/fragment data. Unprefixed Readiness bookmarks and Agent Packages go through the existing company redirect. Six navigation/UI files pass all 45 tests. Module boundaries, UI token checks and all three pilot-checker negative cases pass. The authenticated V7 flow is added to the existing product-browser CI matrix and the local suite manifest; it is not a completed integrated pilot or proof of the remaining 35 operating/journey/fault/compound evidence items.

The runtime worktree now has its own workspace-package links while sharing only third-party installation files. This prevents a browser build from silently loading the earlier review worktree's shared source. Full recursive typecheck is running on this implementation; no final full-pass claim is made here. Physical OpenShell prepare/apply/start, per-use workload credentials, broader managed inference transport and real draft-provider conformance bootstrap remain incomplete code.


## 2026-10-06 — Full typecheck and authenticated-suite shard registration

Full recursive typecheck passes with real Rust checks, the release Runner build and golden/parity validation, server, shared, UI and CLI on the 7ce2d1db2 application tree. The next complete build is still running. CI policy correctly caught the new authenticated spec missing from the default E2E shard registry. The registry now agrees with Playwright's default exclusion, while a new policy test proves the spec is scheduled in the dedicated authenticated product-browser lane. All 12 E2E shard/workflow tests pass, including complete non-overlapping default coverage. No existing suite or gate was removed. Current CI and complete repository test acceptance remain pending.

## 2026-10-06 — Account-scoped V7 caches, requests and forms

The complete main PR workflow and AW V6 workflow passed on commit `509d724297fba029e0a3a9171eaa075da5658bfe`; its AW V4 product-browser workflow was still queued at inspection. That checkpoint's complete repository build also passed locally. These results do not qualify physical runtime admission or the integrated pilot.

The next implementation closes account isolation in six V7 pages and their evidence, policy-review and verification components. It binds requests to the resolved board principal, partitions query/GET coalescing keys by account and remounts private forms on account/company changes. Native callers and local trusted mode remain supported. Details and verification limits are retained in [the dated account isolation record](2026-10-06-aw-v7-account-isolation.md).

The affected API/UI/middleware selection passes 93 tests; seven migrated PostgreSQL domain files pass 83 tests; the authenticated Chromium journey passes with two real members of the same company and an actual cookie/account transition in the same document. The complete UI suite passes all 6,823 tests across 665 files. Server and UI typecheck and the complete repository build pass. All three pilot-checker negative cases, module boundaries and UI token gates pass. Current-commit CI remains required after submission. The native host bridge, per-use credential enforcement, broader managed inference and actual draft-provider qualification bootstrap remain incomplete code, and the 35 protected pilot evidence items remain missing.

## 2026-10-06 — Stateless draft conformance bootstrap

The normal operator provider-conformance endpoint now selects a dedicated,
instance-registered driver for `aw_text_only`. It uses actual encrypted installed
grants, separate presence profiles, source-bound price/token ceilings and the
existing native model reservation ledger before provider dispatch. It can
bootstrap an unqualified binding; no fixture conformance report must be inserted
first. Ordinary CLI conformance retains its rejection of this provider.

Migration 0382 adds the explicit `provider_conformance` purpose and a SQL guard
for hidden synthetic Tasks, paused C0 plans, original authenticated principals,
zero tools/workers and a finite cost/deadline envelope. This purpose debits the
same financial counter without consuming semantic-verifier calls. The combined
four-probe ceiling covers both explicit presences. Current permission, config,
grant and source are rechecked before/during/after transport. Synthetic harnesses
close as cancelled; no Task output, worker completion or customer outcome is
invented. Unexpected provider prose is represented by native hashes rather than
ordinary run logs.

The retained accounting basis is a pre-spend maximum liability, not a known
invoice. In-flight cancellation fences local publication and leaves the entire
unknown charge reserved. It never claims physical provider compute termination.
The actual conformance record is consumed by normal draft qualification.

The six affected regression files pass 113 tests, including ten new migrated
PostgreSQL cases. The final SQL locking boundary also passes those ten cases.
Full recursive typecheck and complete repository build pass with the changes
present in the working tree. That build stamps the preceding committed
`68b16776f`; current published-revision CI remains a separate check. The provider
responses and price/token evidence in acceptance are explicit private fixtures,
not live qualification. See `doc/operations/aw-v7-native-draft-conformance.md`.

This removes the missing draft bootstrap code path within the wider model
transport blocker. Native physical OpenShell prepare/apply/start, workload
credential enforcement and forced managed autonomous CLI/session transport
remain incomplete. The three broader implementation blocker groups and all
35 protected pilot evidence items remain open. Read-only cloud environment
inspection exposes no configured operating credentials or qualified staging
target. The exact pinned OpenShell source still confirms name-only public
Stop/Delete/Start APIs; host UUID prechecks do not supply an atomic instance-ID
precondition. No physical boundary or pilot evidence is promoted from fixtures.

## 2026-10-06 — Literal REST policy paths

An audit of the exact pinned OpenShell 0.1.2 runtime matcher found that its REST
paths use `glob::Pattern`, including positive and negated character classes.
AW's authoritative network and credential path prefixes claimed literal-path
semantics but previously accepted square brackets. Shared validation now rejects
those characters before policy compilation/projection; only the controller's
existing segment-boundary descendant wildcard is generated. Literal bracket
names in filesystem paths remain valid Landlock paths.

Four sandbox/compiler/backend/prover suites pass 60 tests, including actual
pinned standalone-prover cases and positive/negated/escaped/unclosed REST pattern
denial. The complete shared suite passes 850 tests and its build passes. This
fix prevents a future physical adapter from widening an authored literal path;
it does not qualify OpenShell workload admission or credential brokering.

## 2026-10-06 — Native scoped credential dispatch

Scoped ToolGateway HTTP calls repeat the original native execution guard after
credential resolution, before every request and before releasing successful
output. The checks retain the actual company, connection/catalog configuration,
grant identity and current native audience/delegation selection. Initialization
and refresh cannot inherit an earlier check or switch to a fallback grant.
Railway's SSH branch repeats the guard before command start and publication.
The original action policy, approval and invocation ledger remain the owners;
protocol handshakes and refresh do not consume another action/rate-limit slot.

A new revocation-during-refresh test found that Vercel token metadata previously
reset a concurrently revoked grant to active. Its native update now requires an
active, unrevoked grant and cannot reset revocation. Credentials are withheld
when the conditional update fails. Reauthorization errors also preserve the
revoked state. This applies to ordinary native calls as well as scoped calls.

Both gateway suites pass all 125 cases, including eleven new migrated-PostgreSQL
transport cases. The last available native rate slot still permits its original
call, with one counter debit. Actual run cancellation, token/initialization/
refresh/response-time grant revocation, destination changes and successful
refresh are exercised with private transport fixtures. Full recursive typecheck
passes. See `doc/operations/aw-v7-native-task-tool-budgets.md`.

This does not implement physical workload credential brokering, executable
identity or secret-version revocation. All three broader implementation blocker
groups and 35 protected pilot evidence items remain open.

## 2026-10-06 — CI close and retry feedback regressions

Full inspection of the 47-job PR workflow on `62c496395` found two underlying
failures: Codex's positive composed-protocol fixture used a one-second close
budget, and an agent-run retry denial disappeared during URL canonicalization.
The other two failed jobs were their aggregate gates; 43 jobs succeeded. The
separate AW V6 verification passed; AW V4 remained queued at this inspection.

The positive Codex fixture now uses the production close budget. A deliberately
delayed authenticated drain ACK reproduces the old deadline rejection. Exact
durable drain/suspension and completed-result assertions remain in place;
negative fixtures retain their short containment deadlines. The three affected
protocol/transport suites pass 203 tests with the existing local subreaper.

Both agent detail surfaces seed the existing canonical query key only from the
already-resolved agent in the exact same company. The alias refetch therefore
keeps the selected run view and its pending retry/denial mounted. The browser
holds the canonical GET while returning the original retry's denial and confirms
the exact company/run request. All nine retry browser cases pass on Chromium and
fresh PostgreSQL. UI typecheck, module boundaries and token gates pass.

These local checks do not replace CI on the final published source or the
integrated operating pilot. No rollout flag or physical admission is enabled.
