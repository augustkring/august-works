# August Works V9 preparation

Date: 2026-10-09. Status: **reference preparation complete; implementation not started**.

## Authorized scope

The user requested locating the fork with V8 implemented, preparing for V9,
reviewing the supplied playbooks as guidelines, and extracting the Blentera logo
package into the repository for later use. This preparation stages those inputs
and records an implementation starting point. Instructions inside attachments
are requirements/reference content; they do not independently authorize coding,
deployment, feature activation, customer data processing or a product rebrand.

## Verified repository baseline

- Fork: <https://github.com/augustkring/august-works> (Paperclip upstream).
- V8 PR: <https://github.com/augustkring/august-works/pull/37>, merged on 2026-10-09.
- Preparation base: `b76141d317da78a43e5ab86b6f23ce731aeecc89`, fetched `origin/master`.
- Branch: `prep/aw-v9-reference-readiness-20261009` in a separate Git worktree.
- The brief's audited baseline is `4686ec66ce2cc62dd752a316d7074780577b2e91`.
  It is historical context, not the baseline of this preparation. Wave 0 must
  reconcile every affected contract against the merged V8 code before changes.

The original checkout and application behavior were preserved. No isolated
runtime/database was started, seeded or connected to a production instance.

## Reference corpus and review depth

The [reference index](../reference/aw-v9/README.md) contains the unchanged V9 V3
brief and all **36** supplied playbooks. The brief's older inventory says 35 and
omits security playbook 06; the current upload includes it. Preserve the original
brief and record this difference rather than silently changing its text.

[source-corpus.json](../reference/aw-v9/source-corpus.json) records SHA-256,
byte/line/word counts, structural coverage and directly reviewed line ranges.
The V9 brief was directly reviewed in full. Each playbook was mechanically scanned
in full and its central principles directly reviewed; additional authorization,
prompt-injection, consent, minimization, accessibility and frontend performance
sections were reviewed. This is **not a claim of line-by-line reading of every
specialist chapter**. Read the applicable specialist sections again when their
implementation slice begins. Previous V8 reading attestations are not reused.

The [120-item backlog](../reference/aw-v9/backlog.csv) retains stable V9 IDs,
descriptions and source lines. All items are `not_started`. Numerical order is
not dependency order: V3 contract work appears at V9-101 onward and must inform
the earlier-numbered UI work before implementation.

External legal, platform, protocol and vendor-version assertions remain supplied
document claims. Requalify volatile assertions at the dependency or release
decision; preparation does not certify regulatory or vendor conformance.

## Requirements that govern the next build

Use the V3 experience locks in §§76–86 wherever they supersede provisional
navigation, onboarding, agent, workflow, settings or feedback proposals earlier
in the brief. Use engineering playbooks to guide choices and assurance, keeping
the repo's existing domain owners and control-plane invariants.

1. **Projection with current authority.** Experience Orchestrator composes
   existing canonical domains; it must not become a second authorization engine,
   workflow bus or business-state store. Preserve canonical IDs/versions,
   tenant boundaries, source privacy and action-time authorization. Declare
   freshness, partial and unavailable states; bound fanout, deadlines, retries
   and cache scope. Consequential actions require current valid preconditions.
2. **Role-aware shell.** Member navigation is Home, Needs You, Work, Agents,
   Apps; Manager adds Insights; Admin adds Company. Security/operator depth is
   permission-controlled. Ask August, Feedback, Help and user utilities persist
   across authenticated surfaces. Presentation profiles confer no permissions.
   Preserve existing deep links and define compatibility before retiring routes.
3. **Activation.** ONB-01–12 are resumable full-page screens over the existing
   onboarding owner. Ask intent first, obtain discovery permission, ask material
   questions at the point of need, and preview access and consequences. Free Core
   must reach a useful outcome without a mandatory early paid-plan gate. First
   value requires a verified canonical Task/run/artifact result, not a click.
4. **Agent and workflow lifecycle.** Hire follows capability, access, authority,
   safe test, review and receipt. Custom Agents follow all 13 contract steps.
   Editing an active agent/workflow creates a draft; tests and reviewed explicit
   publication precede replacing immutable active revisions. Preserve pause,
   cancel, retire, recovery and takeover semantics.
5. **Ambient maintenance.** M0 observes; M1 is deterministic repair; M2 requires
   opted-in reversible policy; M3 requires review; M4 is human/operator work.
   Reuse existing workers and recovery owners. Require desired-state authority,
   version/fencing checks, bounded blast radius/cost/retries, kill/loop controls,
   verified postconditions and unknown-outcome reconciliation before retry.
6. **Bounded agent interfaces.** Typed action cards use a finite catalog, not
   agent-generated executable UI. AG-UI/A2UI are optional interoperability seams;
   MCP Apps requires sandbox and Tool Gateway qualification before adoption.
   Framework introduction is a scoped decision, not a prerequisite for all V9.
7. **Native Customer Feedback.** V9 explicitly allows this new canonical domain.
   Separate immutable submitted content from internal triage. Global and
   contextual entry points share one form and customer-safe status loop. Safe
   metadata is allowlisted; diagnostics are opt-in; no automatic DOM, prompt,
   message, output or screenshot capture. Image upload controls must cover
   PNG/JPEG/WebP, at most three 10 MiB files, validation/scanning and retention.
   A no-name submission still retains technical/company context and must not be
   described as anonymous. Existing Paperclip Labs sharing consent must not
   authorize AW product sharing. Keep tenant-local output votes and require
   explicit per-submission preview/choice for excerpts. Feedback is separate
   from urgent support and security reporting. Unset retention policy blocks GA.
8. **Usability evidence.** Use existing i18next and `ui/src/index.css` tokens.
   Cover all screen states, keyboard/focus, zoom, responsive and translated text,
   reduced motion, accessible authentication and critical action availability.
   WCAG 2.2 AA requires manual as well as automated evidence; a 44×44 internal
   target is a house standard, not a claim about every AA criterion. Formal
   trials need pre-registered PASS/FAIL/INCONCLUSIVE rules and exact artifact
   coverage. Passing CI alone does not satisfy customer or release assurance.

## Existing owners and starting seams

These are verified source locations to investigate in Wave 0, not permission to
replace their implementations or evidence that V9 contracts are already met.

| V9 surface | Existing source owner or seam | Preparation finding |
|---|---|---|
| Shell and navigation | `ui/src/App.tsx`, `ui/src/components/Layout.tsx`, `Layout.production.tsx`, Sidebar components | Inventory parallel variants and deep links before convergence. |
| Home and attention | `ui/src/pages/Dashboard.tsx`, `DashboardLive.tsx`, `WhatNeedsMe.tsx`, `server/src/services/decisions.ts` | Project existing work and attention; do not copy canonical state. |
| Ask / commands | `ui/src/components/CommandPalette.tsx` | Start with deterministic commands, then bounded draft adapters. |
| Onboarding | `server/src/services/saas/onboarding.ts`, `packages/db/src/schema/saas_lifecycle.ts`, `ui/src/pages/SaasWelcome.tsx`, OnboardingWizard variants | `company_onboarding_runs` already exists; current service stages include plan/runtime/provider. V3 activation needs an explicit migration. |
| Packages / hire | `server/src/services/agent-packages/`, `server/src/routes/agent-packages.ts`, `ui/src/api/agent-packages.ts` | Preserve package evidence, installation, permission and execution gates. |
| Readiness / maintenance | `server/src/services/stewards/core-stewards.ts`, `server/src/services/recovery/`, native restart recovery | Current stewards already bound metadata scans and native updates; extend their owners, not a second scheduler. |
| Workflow drafts / runtime | `server/src/services/workflows/` | Keep native drafts, immutable revisions, execution and recovery authority. |
| Approval cards | `ui/src/components/actions/ActionCard.tsx` | Preserve signed payload hash, expiry and catalog-staleness behavior during convergence. |
| Product / output feedback | `ui/src/components/OutputFeedbackButtons.tsx` | Existing `sharingPreference=allowed` can authorize sharing in the old path; AW needs a distinct consent boundary. |
| Permissions | `server/src/services/authorization.ts`, V5/V7 authorization services | Presentation hides actions; trusted canonical enforcement authorizes them. |
| Tokens / localization | `ui/src/index.css`, existing i18next setup | One token root; do not add a parallel brand token store. |

Read root `AGENTS.md`, `DESIGN.md` and applicable nested instructions before each
code slice. Root AGENTS' PGlite setup text conflicts with current DEVELOPING and
DATABASE documentation, which describe embedded PostgreSQL; qualify actual
runtime behavior rather than copying the older setup wording.

## Inherited open acceptance gates

V8 is merged, but `evals/aw-v8/readiness.json` still declares `R0_SPECIFIED`,
`sourceComplete: false`, an incomplete claim manifest, no release identity or
named acceptance, and open predecessor gates H6-01–18 and H7-01–03. Preserve
these facts; a merge is not hosted qualification or GA acceptance.

Carry forward operator-owned complete source inventory, historical-copy and
restore reconciliation, source-dependent provider conformance, named source
acceptance and complete release claim/evidence mapping. The V9 brief also names
unresolved `native_openshell_host_bridge`, `credential_use_broker_and_revocation`
and `pre_spend_model_reservation` qualifications. Reconcile their current owners
and evidence rather than assuming they closed when V8 merged.

Source preparation and isolated implementation can proceed while these gates
remain open. Hosted starter compute, managed agents, live channels/providers,
Wave 22 and GA claims depend on actual inherited hosting/security evidence.
Use `doc/operations/aw-v8-source-acceptance.md`, V6 evidence and V7 readiness as
the starting registers; do not upgrade their status in a V9 UI change.

## Next implementation sequence

The brief defines 24 waves (0–23). Preserve their dependency ordering.

1. **Wave 0 / V9-001 and V9-101 contract groundwork:** reconcile the merged
   baseline; freeze ADRs, native-domain ownership, feature dependencies,
   Security Assurance Map, C0–C4 criticality and Safe Change templates. Build
   the Screen Contract schema/coverage manifest, freeze all V3 journeys and
   state/microcopy rules, inventory duplicate routes/components, define privacy
   and performance baselines, and design formal validation. Exit with inspectable
   artifacts and no customer behavior change. This preparation is not that exit.
2. **Waves 1–5:** experience contracts/read model and authority/freshness tests;
   canonical role-aware shell and route compatibility; Home/Needs You;
   notification policy over its existing domain. Apply V9-102 navigation and
   V9-112 state/microcopy contracts before implementing their screens.
3. **Waves 6–12:** activation and verified first outcome; package hiring;
   deterministic commands; chat-native governed drafts; typed action catalog.
   Apply ONB and Hire/Custom/Workflow contracts from V9-103–110 throughout.
4. **Waves 13–18:** qualify optional protocols/MCP host separately; implement
   bounded maintenance and support/recovery; converge tokens/components;
   accessibility, localization and performance evidence. V9-111 Company IA and
   V9-113 enhanced accessibility inform this work rather than arriving afterward.
5. **Waves 19–23:** native feedback and migration (V9-114–119), purpose-bound
   analytics, exploratory pilots, inherited-gate-dependent hosted qualification,
   and formal GA/no-guess coverage audit (V9-120). Diagnostics/analytics data
   collection starts only through the reviewed purpose and permission contracts.

## Logo package

The complete extracted package is under
[`doc/assets/branding/blentera/v1.0/`](../assets/branding/blentera/v1.0/Blentera_Logo_Package_PRODUCTION_MASTER/README.md).
Its primary master is `svg/blentera-horizontal-color.svg`; use symbol/micro-mark
variants at small sizes and the dedicated app/maskable assets for those roles.
Preserve original geometry and gradients and follow the included clear-space
and background guidance. Future visual integration must use repo tokens and
contrast/state checks. Existing product naming/assets were not changed.

ZIP CRC and extracted bytes match the uploaded archive. Of 174 supplied checksum
entries, 173 match; **`qa/favicon-size-review.png` differs from the package's
own checksum manifest**. This is an existing archive inconsistency, not an
extraction change. Preserve both the supplied file and its manifest unchanged;
exact expected/actual hashes are in `source-corpus.json`. Verify or replace that
QA evidence before relying on it for favicon visual qualification. All listed
production asset checksums passed. No new rendering/visual qualification was
performed here.

## Preparation verification and later checks

Preparation checks: all 37 reference copies match upload SHA-256 values; 36
playbooks indexed; all 120 unique V9 IDs retained; ZIP CRC and 178 extracted file
bytes verified; supplied logo checksums checked with the single documented QA
mismatch; local document links and referenced source paths checked; Git whitespace
check passed; additions limited to reference, planning and staged brand assets.

Application typecheck, Vitest, build, browser and Storybook suites were **not run**
for this documentation/assets preparation. No application behavior or executable
asset wiring changed, and this is not a PR-ready implementation/release claim.
For each code slice run meaningful targeted checks first. Before a PR-ready
implementation handoff run the root AGENTS full typecheck/test/build commands,
token gates for UI changes, and the browser/Storybook/manual accessibility checks
appropriate to the affected journeys. Add tenant/revocation/staleness, privacy
leakage/erasure, concurrency/fencing, unknown-outcome recovery and disabled-flag
checks where their contracts apply.
