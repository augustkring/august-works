# V9 onboarding permission consent — 2026-10-11

Implement the full §78.9 access decision beside the existing onboarding owner.
The current handoff only reads setup metadata. It does not record purpose-bound
consent or safely defer access to the first agent.

## Existing owners and concrete gaps

- `activation.ts` verifies the original named human, current native membership,
  onboarding initiator, selected package and bounded company/session locks.
- `activation-connections.ts` reads original Apps metadata. It currently requires
  a company installation for `recorded`, which grants future agents access and
  does not establish this onboarding purpose's consent.
- `ConnectionSetupFlow` uses organization identity and all-agent installation
  when no requested agent exists. ONB-08 precedes creation of the first agent.
- Original `finishToolAppSchema` already permits specific access with an empty
  agent list; the existing UI does not permit that selection.
- Original gallery allocation creates a new random application/connection and
  independently persists grants. Package requirements name actual application
  keys; a gallery slug is not that key. Do not guess a provider from a name or
  fabricate a matching application key.
- Original reconnect/resume preserves the persisted grant identity. Preserve
  ordinary Apps, task connection, OAuth, credential and reconnect behavior.

## Implementation

1. Extend the original activation-owned read with a current per-system preview:
   needed resource/scope, first-outcome purpose, intended capability, actual read
   scope, actual change scope, exclusions, automatic use and operations that
   require another decision. Resolve the native required application and its
   supported original method. Bind package revision, onboarding revision,
   account, company, method and actual requested scope/resource configuration.
   Unknown metadata is unavailable, never invented read-only authority.
2. Record a separate explicit C3 decision in an immutable minimal native receipt
   before resource authorization. Provider consent is not AW business authority.
   A personal connection has no agent installation or company profile binding at
   this point. Server ownership enforces that restriction; client props do not
   grant it or let a request silently expand to organization/all-agent access.
3. Add an original P2 allocation seam that binds the actual connection to its
   existing approval in the same native allocation transaction. Preserve original
   credentials, vault, provider validation and OAuth controllers. An unknown
   reply must recover the original durable request/connection, without allocating
   a second connection, grant or new credential owner.
4. Host the original setup flow inline. Add an explicit deferred-agent mode with
   personal identity, zero agent access and current-account fences. Preserve
   ordinary defaults elsewhere and all resumed connection identity rules.
5. Recheck actual personal grant, current connection/method/resource version,
   current health and the exact native consent before continuing ONB-08. A
   generic company installation does not qualify this purpose. `Not now` states
   the degraded outcome and keeps the safe capability-reselection path.
6. Later promotion refers to the actual paused first agent and its original
   representative Safe Test/current mapping. It needs its own exact review. Never
   allocate a placeholder agent early or borrow another revision's qualification.

## Verification and limits

Retain the existing full Apps/activation/account/permission suites and their
assertions, budgets and timeouts. Add current-source/membership withdrawal,
changed method/scope, wrong company/package, missing C3, zero future-agent reach,
unknown acknowledgement and exact-request resume Native cases. UI checks cover
all eight labels, separate decisions, personal/zero-access defaults, original
reconnect behavior, keyboard focus, narrow viewport and stale-session hiding.

Native owned fixtures qualify local ownership; software OAuth replies qualify
UI behavior only. Neither supplies real provider credentials, deployed consent,
Safe Test, Free Core hosting/funding or first-value release evidence. Current
source is pending implementation and does not qualify full V9 or PR readiness.


## Original consent/allocation owner implemented; qualification pending

The current source implements the strict eight-field review, a separate C3
approval on the original Native onboarding owner, immutable minimal receipt,
private reservation and same-transaction original Apps connection binding.
Managed Google scopes come from the original connector profile; availability is
read outside native locks. The dedicated endpoint accepts only explicit provider
setup confirmation and derives the personal identity/application/method from the
original approval. It allocates once and leaves provider sign-in to the shared
setup flow after a confirmed reply. It does not start OAuth twice on dialog setup.

Original connection insert and receipt binding commit together. An unknown reply
can read the original receipt; an allocating reservation never appears as a
positive connection UUID. Later provider errors retain the already-bound row.
Native guards preserve the original receipt, personal identity and zero Agent or
company installs/profile bindings/delegations. Original OAuth finalization and
finish refuse organization promotion or Agent reach for this deferred connection.
Existing normal Apps, reconnect and access defaults stay with their original owner.

Qualification history is preserved, not promoted to a pass:
- Focused contract/unchanged UI tests: 31 cases / 4 files passed.
- Native V1: 427 passed, 6 failed / 433 cases; owned allocation fixtures lacked
  controlled DNS and one version fixture bypassed the original onboarding writer.
- Native V2: 433 passed, 1 failed / 434 cases. Seven new owner cases and all
  original packages/activation/Apps cases passed. The new HTTP fixture used the
  wrong membership property; its correction still needs the full Native rerun.
- Type V1 did not reach the compiler because cargo was absent from its PATH.
- Type V2 Shared/DB builds passed; server types found a missing conflict import
  in the new account guard. Fixed source must pass the original full type command.
- No provider sign-in, credential claim, live Google access or customer data was
  used. Native tests use original PostgreSQL and controlled software metadata.

The complete inline UI, explicit withdrawal/current receipt reload, current
purpose recheck at every provider/finish boundary, connected-state writer and
legacy-connection purpose adoption/activation continuation are still open.
The preview currently supports actual enrolled managed Google profiles without
resource configuration; GitHub App permissions, API-key authority, customer OAuth
and configurable resources need their own verified original preview.
The declared connected receipt state is not a writer or qualification by itself.
No Agent promotion, Safe Test, hosted Free Core, usable first value, full V9 or
PR readiness is claimed. Continue the original complete V9 implementation.


## Qualified original consent/allocation owner (2026-10-11)

Native V5 passed all 434 cases in all three complete original suites (351 Apps,
72 packages, 11 activation), including all eight new ownership cases. Shared/DB
builds and the original full server/UI type commands passed in Types V4.
Both runs froze HEAD a5bba5f233ed63ea597c0f374bae6248807ff847 plus the
refusal-only first-task diagnostic at Source SHA256
4628ddabd9c07f0162a135e1d63c835a369aa33b223f84d1a854c3a8e0df91b3.
The before/after source hashes match. Actual migrated PostgreSQL and native
ArtifactSandbox ran as UID 1004 with no network in owned fixtures.

Native V4 previously passed all eight new cases but failed an existing first-task
candidate assertion (433 passed, one failed). The retained diagnostic calls its
original owner only on an empty projection; it does not weaken that assertion,
change authority or create missing proof. V5 did not reproduce the empty
projection, so its original cause is unresolved and needs assessment in the final
full run. Types V3 did not start after V4 failed. No failed stage is a pass.

This qualification covers original consent/allocation only. The independent
onboarding-permission UI branch contains unfinished/unqualified follow-up work;
inline UI, original current-purpose boundaries, withdrawal, connected-state
writing and activation continuation are not qualified by this checkpoint.
No real provider authorization, deployed credentials, Agent access, Safe Test,
first value, complete V9 or PR readiness is claimed.
