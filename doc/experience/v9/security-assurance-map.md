# V9 Security Assurance Map

Source assurance map, not release acceptance. The V9 brief defines product behavior;
the attached playbooks provide guidance. Native authority and evidence gates remain.

| Failure boundary | Class | Canonical control | Source verification | Remaining evidence |
|---|---|---|---|---|
| Foreign company / stale membership | C3 | Native current company/resource authorization, final recheck, principal-scoped browser keys | Migrated V9 experience tests | Hosted revocation/session races |
| Stale action / invented source version | C3 | Typed native source/version; nonfresh cards only navigate; mutations return to native owner | Shared experience tests | Complete native-action/browser matrix |
| Slow dependency / fan-out / late result | C2 | Eight-reader admission, deadline/abort, held reservations, partial state, no automatic retry | Projection tests | DB faults, cancellation and representative load |
| Presentation profile grants access | C3 | Native grant-derived maximum; depth preference cannot grant an action | Shared and migrated experience tests | Authorized Advanced entry and role matrix |
| Expert destination widens access or changes tenant | C3 | Fixed ID/destination pairs, current native feature/permission filters, company-prefix route registration | Shared destination checks, migrated gate/revocation checks, local-board browser navigation | Hosted expert-role matrix and hidden-settings policy |
| Duplicate setup / legacy writer / false first value | C2/C3 | Native onboarding owner, row locks, version/hash receipts, database legacy-writer fence; only qualified customer capability selection; execution remains closed | Migrated activation tests, route/back/draft DOM tests | Complete execution/artifact first-value proof and mixed-version deployment drill |
| Quiet hours delay security or duplicate optional email | C2/C3 | Native encrypted outbox and preferences; mandatory security delivery; company/user/category/local-day digest key; real IANA/DST time handling | Native notification/outbox tests and summer/winter clock-change tests | Provider/channel delivery, responsible-owner/deadline policy and old-worker drain |
| Untrusted card markup/tool output | C3 | Finite typed catalog, escaped text, same-origin navigation, tenant checks | Shared experience tests | Adversarial chat/channel/protocol adapters |
| Feedback metadata/diagnostic leakage | C3 | Strict allowlists; server route template; explicit opt-in; no raw URL/error/log body | Shared/migrated feedback tests | Browser leakage and logging review |
| No-name identity revealed in triage | C3 | Null submission author; private ownership relation excluded from triage; separate audit purpose | Migrated feedback tests | Privacy correlation/retention/access review |
| Other user's history / staff notes | C3 | Current membership plus submitter ownership; safe customer receipts; verified configured operators | Migrated feedback tests | Operator/offboarding/support matrix |
| Duplicate submit / rewritten original | C2 | Request hash/key, aggregate version, transaction, immutable submission/event triggers | Migrated feedback tests | Fault recovery and mixed-version drill |
| Legacy blanket output sharing | C3 | Monotonic local-only policy; old consent cannot export; skip bundle capture; worker rechecks | Migrated feedback privacy tests | Quiesce old workers; exact rollout/config proof |
| Hostile image / unknown write / erasure | C3 | Upload admission closed until scanner/storage/reconciliation/erasure qualification | No image acceptance claimed | Entire protected image lifecycle |
| Maintenance expands authority | C3/C4 | Native current/desired authority, policy tier, CAS/fence, kill/budgets, verified outcome | Pending source slice | Domain safety case; C4 excluded without applicable standard |
| Protocol iframe/tool escape | C3 | Optional flags off; finite catalog, Tool Gateway and sandbox qualification | Pending source slice | AG-UI/A2UI/MCP Apps isolation proof |

Source suites: `packages/shared/src/experience.test.ts`,
`packages/shared/src/customer-feedback.test.ts`,
`server/src/services/experience/projection.test.ts`,
`server/src/__tests__/v9-experience.integration.test.ts`,
`server/src/__tests__/v9-customer-feedback.integration.test.ts`.

## C0–C4 mapping

- C0: reversible presentation preference without data/authority effects.
- C1: navigation and read-only summaries.
- C2: durable internal drafts, feedback and ordinary state changes.
- C3: access, privacy, external effects, spending, publication or destructive change.
- C4: safety-critical/domain regulated consequences; domain standard and independent
  evidence required. V9 does not downgrade consequence or invent certification.

An operation inherits its highest material consequence. Labels, profiles, flags
and unit checks cannot lower it. Safe Change records in the dated build ledger
identify owner, authority/data changes, migration/mixed versions, irreversible
boundary, admission, rollback, exact source/config identity and residual evidence.
Existing erasure/history APIs and the output-sharing privacy latch survive rollback.
