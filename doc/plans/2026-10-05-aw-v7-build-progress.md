# August Works V7 full-brief implementation ledger

Date: 2026-10-05. Branch: `codex/aw-v7-wave0`. Source: user-supplied V7-v2 build brief.

The user has requested implementation of the whole brief. Work continues through all twenty waves. Code, local tests, provider qualification, customer validation and production acceptance are separate evidence states. Default-off flags remain closed until the relevant evidence exists. This ledger must not label a declaration or scaffold as a completed feature.

| Wave | Deliverable | Current evidence state |
| --- | --- | --- |
| 0 | Post-V6 audit and rollout contracts | Configuration slice committed; predecessor/provider/legal acceptance remains scoped/open |
| 1 | Readiness and Knowledge Quality | Implemented: schema, policy, authorized source integration, scoped API and UI; eleven service/policy and three UI tests pass |
| 2 | AI-assisted Foundation bootstrap | Implemented and locally verified; six migrated-PostgreSQL tests pass |
| 3 | Cognitive provider contract | Pending implementation |
| 4 | Hindsight spike and adoption decision | Pending implementation |
| 5 | Observations and Mental Models | Pending implementation |
| 6 | Organizational Learning | Pending implementation |
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
