# August Works V7 preparation review

Date: 2026-10-05. Status: preparation findings, not implementation or launch approval.

## Request and authority

The user's initial request was to study the supplied playbooks, V7 build brief and August Works codebase before beginning implementation. This review does not execute the implementation instructions embedded in those documents. The brief supplies proposed product requirements; the playbooks supply reference standards. Neither document content nor a model recommendation grants deployment, messaging, billing or production-data authority.

## Baseline and review coverage

- Repository: `augustkring/august-works`.
- Reviewed baseline: master `137e6ab386d6e579e9057d2c44b583a7167dc29f`, including the V6 merge in PR #34.
- Original local checkout: `work` at `f9f6d8e8f9c8df87b42eaa59b126d63b025a57a1`, an older V5 state. It was preserved.
- Separate review worktree (initially detached; subsequent Wave 0 branch `codex/aw-v7-wave0`): `/workspace/august-works-v7-review`.
- Inputs: exactly 37 current uploaded documents: 36 playbooks and one V7-v2 brief; 702,243 words and 158,310 lines in total.
- The V7 brief was read across its complete section sequence. All 36 playbooks received a structural and core-standard review. Selected security, privacy, agent memory, autonomy, approvals, runtime and assurance sections received deeper reading. This is **not** a claim that every playbook paragraph was read or its references independently revalidated.
- All 8,359 tracked regular files were inventoried with content hashes, size, text/binary classification and line counts. The inventory contains 8,227 UTF-8 text files and 3,047,997 text lines, including documentation, fixtures, generated content and metadata. Reading files programmatically for inventory is **not** semantic review.
- Code review covered architecture entry points, contracts, schemas and selected implementations for company authority, trust boundaries, workflows, memory, completion, V5 and V6. Large files and the rest of the repository have **not** received a complete line-by-line audit. The current review prepares Wave 0; it does not satisfy the literal request for exhaustive reading of all source lines.

Machine-readable input and source inventories are retained outside the repository at `/workspace/v7-preparation-inputs.json` and `/workspace/august-works-v7-source-inventory.json`.

## Playbook reference map

Each entry below records the principal standard retained from the structural/core-standard review. It is a relevance map, not field-validation evidence.

| Uploaded playbook | Standard relevant to this work |
| --- | --- |
| 01 Requirements and domain engineering | Observable acceptance, canonical vocabulary, invariants and traceability before schemas. |
| 02 Architecture and system design | Explicit ownership and boundaries; the simplest adequate architecture; contextual ADRs. |
| 03 SDLC and configuration management | Controlled changes, reproducible configuration and evidence linked to exact revisions. |
| 04 Construction and code quality | Local reasoning, explicit errors and boundaries; avoid unnecessary abstraction. |
| 05 Verification and validation | Select tests by failure claim; testing and fitness for use are different evidence. |
| 06 Security | Deterministic authority, adversarial boundary tests, bounded privilege and recoverable trust. |
| 07 Privacy | Purpose differs from access; derived data has lifecycle duties; deletion must survive restore. |
| 08 Reliability and SRE | Outcome reliability, bounded retries and queues, tested restoration and incident learning. |
| 09 Performance and cost | Representative workload measurements and total cost per accepted outcome. |
| 10 DevOps and supply chain | Immutable artifact identity; provenance, signatures, SBOMs and authorization are distinct. |
| 11 Maintenance and migration | Safe intermediate states, one write authority, reconciliation and proven recovery paths. |
| 12 Data and storage | Authoritative invariants, concurrency, tenant isolation and derived-store deletion/rebuild. |
| 13 API and distributed systems | Unknown effects, scoped idempotency, finite deadlines, leases/fencing and reconciliation. |
| 15 Backend and engines | Durable work identities, separate attempts, bounded workers and restart-safe state. |
| 16 Mobile and desktop | Interruption, local-state authority, permission revocation and safe update lifecycle. |
| 17 Cloud and IaC | Separate desired/provider/observed state; actual isolation proof and lifecycle ownership. |
| 18 AI/ML/LLM | Whole-system evaluation, protected holdouts, abstention and quality floors before cost. |
| 19 Agentic AI | Current reauthorization, attenuated delegation, exact-action approvals and model-independent stop. |
| 20 Blockchain | Irreversible effects, exact signing intent, replay limits and independent reconciliation. |
| 21 Systems and real time | Explicit resource/concurrency contracts; runtime and platform evidence match claims. |
| 22 Language and runtime | Controlled toolchain, runtime validation, owned async work and explicit numeric semantics. |
| Concept and business design | Value creation/delivery/capture; customer facts remain separate from design assumptions. |
| Graphics and visual production | Exact product facts stay deterministic; visual provenance and accessible meaning. |
| Visual design and art direction | Meaning and hierarchy first; reuse the existing visual grammar and review real states. |
| Google Ads | Business economics, reliable conversions and bounded evidence-based spend changes. |
| Market validation and pretotyping | Test critical assumptions with behavioral evidence; PASS/FAIL/INCONCLUSIVE/INVALID. |
| Marketing measurement | Attribution differs from causality; backend business truth and explicit uncertainty. |
| Brand strategy | Deliverable positioning, reasons to believe and preserved distinctive assets. |
| Master Playbook Standard | Outcome → evidence → decision → action → verification → evaluation → learning. |
| Meta Ads | Tracking quality, distinct hypotheses, marginal economics and scoped retained learning. |
| Organic discoverability | Eligibility and source quality; visibility/citations do not prove business impact. |
| UI | Appearance, semantics, state and behavior agree; truthful progress and consequence previews. |
| Universal design principles | Task clarity, accessible hierarchy and evidence before decorative complexity. |
| Universal software/AI engineering | Risk-proportionate assurance, explicit state/authority and the least complex adequate system. |
| UX | Whole customer outcome, cheap correction, meaningful control and failure recovery. |
| Web/frontend engineering | Browser is an untrusted client; native semantics, explicit async states and real-browser proof. |

The standalone frontend playbook identifies itself as engineering domain 14. Security domain 06 was uploaded but is absent from the brief's 35-playbook audit matrix; include it explicitly in V7 security traceability. Research-review and “Golden Master” labels must not be promoted into representative production validation.

## Existing implementation to extend

| Existing authority or capability | Primary source locations | V7 consequence |
| --- | --- | --- |
| Company/action/resource authorization | `server/src/services/authorization.ts`, `server/src/routes/authz.ts`, `server/src/services/tool-access-policy.ts` | Reuse current authority; readiness and model judgment cannot grant access. |
| Tool actions, approvals and receipts | `server/src/services/tool-access.ts`, `server/src/services/tool-gateway.ts`, `packages/db/src/schema/tool_access.ts` | Bind intervention approvals to canonical material parameters and existing durable effects. |
| Trust presets and low-trust containment | `packages/shared/src/trust-policy.ts`, `server/src/services/trust-preset-resolver.ts`, `server/src/services/low-trust-runtime-containment.ts`, `server/src/services/source-trust.ts` | Preserve restrictive intersection, concrete scopes and quarantined untrusted output. |
| Foundation and document revisions | `server/src/services/foundation/`, `packages/db/src/schema/foundation.ts` | Learning proposes changes to existing reviewed truth; it cannot overwrite approved pointers. |
| Memory, retrieval and erasure | `server/src/services/memory/`, `packages/db/src/schema/memory.ts` | Cognitive providers receive eligible projections; current source ACLs, lineage and deletion remain authoritative. |
| Durable workflows and delegation | `server/src/services/workflows/`, `server/src/services/heartbeat.ts` | Planning and supervision extend durable execution, current principal checks and existing retry/cancel semantics. |
| Native completion and evidence | `packages/db/src/schema/completion_contracts.ts`, `server/src/services/native-runtime/completion-contracts.ts`, native finalization/status evidence tables | There is already a company-bound immutable completion-contract ledger. Extend/version it; do not create a competing ledger. |
| V5 identities, behavior versions and manifests | `doc/adr/V5-ARCHITECTURE-DECISIONS.md`, `packages/shared/src/execution-manifest.ts`, Role Pack/Skill/Playbook services | Catalog packages pin existing immutable behavior; logical identity and behavior metadata remain separate from authority. |
| V6 deployment, billing and runtime | `server/src/services/saas/`, billing services, `packages/shared/src/billing/catalog.ts`, `deploy/v6/`, `infra/` | Keep existing SaaS tenancy, runtime cells, outboxes, metering, support and recovery ownership. |
| UI and route composition | `server/src/app.ts`, `ui/src/App.tsx`, `ui/src/index.css`, `DESIGN.md` | Extend existing product surfaces and semantic tokens; keep safety controls and user consequences clear. |

The existing `tool-runtime-supervisor.ts` supervises local MCP fixture runtime slots. Its name alone does not prove the worker/semantic-supervisor/intervention-arbiter contract required by V7.

## Material gaps and reconciliation decisions

1. **Refresh the predecessor audit.** The brief predates the current V5/V6 merges. Compare against the pinned master above, preserving the V4/V5/V6 canonical-contract boundaries. Historical merge state is no longer a blocker; production qualification remains separate.
2. **Keep V6 evidence gaps visible.** `doc/operations/aw-v6-evidence.md` explicitly leaves live UpCloud, Paddle, Mailgun, kernel/image isolation, recovery, erasure-completeness and hosted customer journeys open. Source fixtures and local tests do not close those gates.
3. **Plan Free Core as a real commercial migration.** V6 `EMPTY_ENTITLEMENTS` defaults platform, agent creation, workflows, memory and portfolio to false. `saas-commercial-guard.ts` requires platform entitlement for material mutations. V7 must introduce a permanent free baseline and sell capacity/managed runtime/storage/assurance through existing billing accounts and reconciliation. Preserve data, security/privacy actions and permissions on downgrade; payment never grants authorization.
4. **Reconcile schemas before generating them.** Completion contracts already exist. The brief also uses differing status vocabularies in conceptual and detailed sections for observations, learning cycles and readiness. Choose one canonical vocabulary and migration contract in Wave 0.
5. **Qualify cognitive memory conditionally.** Hindsight is an optional provider spike behind a narrow contract. Before adoption, prove authorized projection/query, company and private-agent isolation, correction, provider deletion receipts, derived invalidation and restore non-resurrection. Provider output never becomes approved company truth directly.
6. **Qualify sandbox enforcement conditionally.** OpenShell sits below the V6 runtime-cell boundary. Bind evidence to actual backend/kernel/image identity, require monotonic policy restriction and test forbidden filesystem/network/process/secret paths. Unsupported enforcement cannot silently satisfy a stronger assurance profile.
7. **Add task-tree budget and supervision contracts.** Root reservations plus consumption and child allocations must remain bounded under concurrency. Keep exact-action approvals, durable attempts, intervention idempotency, bounded retry, grace/hysteresis and independent hard-stop paths. A second LLM is not automatically an independent verifier.
8. **Preserve governance and purpose ownership.** Version intended purpose and use-case/operator-role assessment. Inventory observations, inferred models, memory projections, evals and traces as data surfaces. Separate DPIA, FRIA and broader AI impact assessment applicability. Revalidate time-sensitive legal/vendor claims from current primary sources before relying on them in implementation.
9. **Validate packaged specialists as products.** Installation differs from activation and permission consent. Reuse Role Packs/Skills/Playbooks with immutable releases, evals and limitations. Validate Chief of Staff and Growth/Research demand; do not infer market proof from a coherent package design.

Searches for the brief's named V7 schemas and Hindsight/OpenShell/Free Core terms did not find matching implementations in the inspected schema, shared-contract, service and page directories. This is a scoped search result, not proof that no conceptually related code exists elsewhere.

## Implementation sequence retained from the brief

| Waves | Work and release boundary |
| --- | --- |
| 0 | Audit current master and predecessor evidence; contract/gap map; canonical state vocabularies; V7 ADRs and default-off flags. |
| 1–2 | Action-specific readiness/quality findings and governed Foundation bootstrap. |
| 3–4 | Cognitive-provider contract and Hindsight adopt/defer qualification spike. |
| 5–6 | Evidence-rooted observations/models and evaluated learning proposals. |
| 7–9 | Orchestration plans/task-tree budgets, deterministic supervision, semantic supervisor and verifier. |
| 10 | Authorized Work Signals and follow-up using existing tasks/Routines/notifications. |
| 11–12 | Sandbox abstraction/compiler/negative-test harness and OpenShell qualification. |
| 13 | Versioned AI use cases, purposes, oversight and obligations. |
| 14 | Free Core cutover through existing billing/entitlement contracts. |
| 15–17 | Governed package foundation, initial specialists and event-driven stewards. |
| 18 | Contracted enterprise identity/assurance capabilities with explicit security boundaries. |
| 19 | Integrated pilot and fault/recovery/privacy evidence. |

The brief's illustrative PR list is a decomposition aid. Dependencies and atomic invariants determine actual PR boundaries. Default-off implementation can proceed where prerequisites permit; enabling a dependent feature requires its actual acceptance evidence.

## Checks executed in this preparation

On the pinned review worktree:

- `node scripts/check-module-boundaries.mjs`: PASS.
- `node scripts/check-aw-v4-security-eval-coverage.mjs`: PASS; validates the coverage map (18 gates, 7 eval domains, 27 deterministic suites, 17 behavior metrics), **not execution of those suites**.
- `node scripts/check-token-gates.mjs`: PASS; 1,130 files scanned, all four token gates clean. This does not include the additional palette/character sync checks in the full package script.

No full typecheck, Vitest run, build, browser journey, provider test or production rehearsal was executed in this preparation. The review worktree has no installed dependencies. The environment has Node 24.19.0 but pnpm 11.19.0, while the repository specifies pnpm 9.15.4; use the repository toolchain before implementation verification.

No product code, SQL migration, deployment configuration, billing transaction, external message or production resource was changed. This preparation document is the only repository-file addition in the review worktree. Before starting a coding branch, refresh the target head and finish a change-focused review of affected large services and callers; this note does not replace that review or the outstanding exhaustive reading.

## Subsequent work

The user subsequently requested continuation. Wave 0 configuration admission is now being implemented on `codex/aw-v7-wave0`; see [the Wave 0 evidence ledger](../operations/aw-v7-wave0.md) for implementation scope and verification. Earlier preparation-only findings describe the initial review, not the final worktree state.
