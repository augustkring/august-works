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
