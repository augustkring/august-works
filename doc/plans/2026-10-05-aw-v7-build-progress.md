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
| 6 | Organizational Learning | Domain and evaluation-contract implementation in progress |
| 7 | Bounded orchestration | Pending implementation |
| 8 | Deterministic supervision | Pending implementation |
| 9 | Semantic supervision and verification | Pending implementation |
| 10 | Work Signals and follow-up | Pending implementation |
| 11 | Sandbox abstraction | Pending implementation |
| 12 | OpenShell backend and qualification | Pending implementation |
| 13 | AI purpose and assurance governance | Pending implementation |
| 14 | Free Core and capacity | Pending implementation |
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
