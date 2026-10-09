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
| Command escalates authority / automatic model execution | C2/C3 | Explicit deterministic grammar; fixed destination IDs; bounded current-authority native resource reads; draft/navigation only; semantic authoring unqualified | Shared grammar, migrated membership/hidden-resource and DOM account-switch/draft checks | Full governed semantic adapters and representative command journeys |
| Feedback or command prose in generic HTTP logs | C3 | Closed request/response projection, route templates without identifiers, omitted bodies and sanitized error metadata on all methods | Native logger canary checks and existing redaction regression suite | Hosted observability/retention audit |
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

| Unpublished agent content | `agent_configuration_drafts` native agent owner | Creator/company/current create or target configure/read; verified membership | Scope/baseline/request/version fences; no production writes or grants | Focused native/HTTP/DOM; complete publish mapping and hosted proof pending |
| Agent installation reconciliation | Existing native package installation | Installing principal/company/request plus current agent authority | Immutable normalized request/path hash; current receipt survives withdrawal/uninstall | Native concurrent replay/conflict cases; customer Hire flow qualification pending |
| Restore admission across V9 flag changes | Native instance settings/quarantine | Operator-owned private metadata never becomes public settings input | Atomic privacy-latch merge preserves restore quarantine | Existing restore regression reproduced; corrected native recheck pending |
| Pinned unpublished Hire setup | Same native agent configuration draft owner | Current verified creator/company agents:create; no admin bypass | Immutable native version/key/hash; per-kind steps; capability declarations cannot broaden; original request/version retries | Migrated native and DOM checks; connection assessment, execution/verification/publication and active receipt still open |
| Needs You / Work projection | Existing Attention, Tasks and native work/resolver owners | Current company/principal plus source resource visibility | Navigation only; native page boundary is observed partial coverage; conservative consequence copy and no invented counts | Native 26-approval pagination and shared/DOM state/account checks; full adapters, inline actions and human qualification remain open |
| Workflow plain-language review | Existing native workflow/revision owner and learned-asset privacy checks | Required current human principal and native workflows:read/edit; admission/read recheck after assembly | Published revision and draft separated; config/prompts/credentials/inputs/results omitted; bounded topology is unavailable rather than truncated; declarations confer no effective authority or test result | Native grants/revocation/foreign-account and private projection tests plus DOM late-response checks; full lifecycle and human qualification remain open |
| Agent revision entry | Existing native private authoring owner | Current verified membership plus create/configure and target read; no instance-admin bypass | Metadata-only bound IDs; private/no-store; final authority recheck; feature rollback and late-navigation context guard; no proposal/configuration/grant writes | Native admission/write-absence and HTTP/OpenAPI/DOM checks; active writer fencing and publication qualification remain open |

| Workflow draft comparison | Existing private native workflow/revision owner | Same current human/read/privacy admission and final recheck | Native-ID/dependency-bound change indicators only; private values/signatures remain in-process; bounded unavailable state; no write/grant/test/publication | 22 projection/binding, 4 DOM and 20 native route cases plus OpenAPI checks; full lifecycle and human qualification remain open |

| Workflow attempt inspection | Existing native executor private-payload/source admission and exact historical revision owner | Current human/company/workflows:read plus final recheck | No raw inputs/outputs/errors/actor IDs/decisions; strict bounded metadata; historical state explicit; no-store/log minimization; authority and source-loss epochs; no writes | 16 projection, 5 run DOM, 4 review DOM, 11 log-policy and 20 migrated native route cases plus OpenAPI/contract checks; complete selected-actor/branch/verification and human qualification remain open |
