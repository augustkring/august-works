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
| 6 | Organizational Learning | Core and eight native target adapters verified, including evaluated Optimizer candidates; Agent Package adapter belongs to Wave 15; broader evaluation and integrated acceptance remain open |
| 7 | Bounded orchestration | Canonical admission/control and reviewed terminal acceptance/joins verified locally; broader compound-budget and automated-provider qualification remains scoped |
| 8 | Deterministic supervision | Canonical observer, deterministic arbiter, durable Stop/retry queue and stopped-worker reassignment implemented; local verification passing |
| 9 | Semantic supervision and verification | Evidence-bound human trajectory review and independent completion consumer verified; automated read-only semantic provider remains a qualification dependency of Waves 11–15 |
| 10 | Work Signals and follow-up | Conservative source-bound extraction, human Roadmap drafts and durable native review cards verified locally; semantic provider and live Slack qualification remain scoped |
| 11 | Sandbox abstraction | Backend contract, strict compiler, native cell binding, qualification harness and fail-closed admission locally verified; physical OpenShell enforcement belongs to Wave 12 |
| 12 | OpenShell backend and qualification | Actual pinned prover and conservative adapter verified; physical/native-host/broker qualification remains open |
| 13 | AI purpose and assurance governance | Versioned registry, accountable assessments, native execution fences, durable Stop, obligations and bounded evidence export verified locally; package inventory extends in Wave 15 |
| 14 | Free Core and capacity | Native no-card baseline, atomic concurrent-run capacity and scoped managed-runtime downgrade locally verified; launch economics remain an acceptance gate |
| 15 | Agent Packages | Pending implementation |
| 16 | First specialist candidates | Pending implementation |
| 17 | Core Stewards | Pending implementation |
| 18 | Enterprise operating envelope | Pending implementation |
| 19 | Integrated pilot and fault injection | Pending implementation |

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

The automatic read-only semantic evaluator/verifier adapter is not represented as qualified or active. Its provider, capability isolation, depth and pre-spend budget must be wired/qualified alongside the sandbox and Agent Package work in Waves 11–15. The implemented human consumer keeps material semantic completion governed in the meantime; this is not a claim of live LLM evaluation quality.

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
