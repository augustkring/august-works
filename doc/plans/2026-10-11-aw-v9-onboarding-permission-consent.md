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


## Inline permission/completion follow-up — qualification pending

The independent UI branch now implements all eight labels, separate checkbox C3
approval/withdrawal, original receipt recovery and session-only immutable command
identity. It hosts the original flow with a locked managed Google method,
personal identity and zero Agent access; host epoch guards also cover the OAuth
navigation handoff. Ordinary Apps/reconnect transports retain their owner.
Original provider start, managed callback and finish recheck the current Native
purpose. The callback refuses withdrawn/current-source drift before broker claim
and rechecks inside credential persistence; issued scopes must match the review.

Original Apps finish now writes connected evidence in its own transaction, after
actual personal grant/secret metadata, current health and unassigned deny-default
profile checks. Native 0471 adds positive-evidence/callback fences. Activation
continuation rechecks the immutable purpose and current original material setup;
no Agent, installation, delegation, execution or Safe Test is inferred. Existing
connections without these receipts still use legacy setup metadata, and their
purpose adoption/reconnect/promotion remains unfinished.

Focused V2 passed 25 cases in five complete contract/UI files. Native V1 did not
start cases due to new worktree directory access for UID1004. Native V2 passed
436 cases and failed two existing first-result cases / 438 total; all 12 new
cases passed. Types V1/V2 did not start after those failures.
The first-result diagnostic established that its exact original evidence reader
succeeded while candidate projection was empty: the global twenty-choice discovery
page omitted the selected qualified version. The current fix independently reads
that exact Native pin, keeps the same qualification/revocation checks and retains
the twenty-choice bound. A 21-release original-publisher regression and original
managed-callback software cases have been added; their full qualification is
pending. Original assertions, clock/read budgets and deadlines are preserved.

The built-browser C3/keyboard/narrow-view/recovery case is Source only and not yet
run. No real provider authorization or production credentials were used. Full
78.9, Safe Test, first value, complete V9 and PR readiness remain pending.


Native V3 passed 440 cases and failed the new positive managed-callback case /
441 total; all original 426 cases and the bounded-discovery regression passed.
The original callback temporarily marks its application draft before finish;
that invalidated the already-approved active application. Follow-up source keeps
that existing application active in this purpose mode, while the actual connection
still stays draft until original finish validates personal credentials/health and
activates it. The pre-finish read may inspect that healthy draft; positive Native
connected evidence still requires the actual active connection and unassigned
profile after original finish. Types V3 did not start. This correction is pending
Native/type/browser verification; no original assertions or budgets were changed.

## Original inline permission flow and completion qualified (2026-10-11)

The current follow-up hosts the original connection flow inline after C3,
preserves personal identity and zero Agent reach, reloads the immutable original
command/receipt after unknown replies, and keeps withdrawal a separate explicit
decision. Original provider and finish boundaries recheck the actual initiating
human, current package/application/method, scopes, personal grant, secret metadata
and health. Original finish records positive connected evidence in its own Native
transaction; migration 0471 independently guards that evidence. Neither a reserved
UUID nor a provider callback alone counts as completed setup.

The bounded discovery projection was the cause of the original empty first-task
capability projection: the current selected publication could fall outside its
20 displayed choices. The original owner now independently reads that exact
selected publication under the same qualification/revocation rules, retaining
the original page bound. The Native regression creates 21 earlier publications,
then verifies both retention of the selected choice and refusal after revocation.
The original first-result assertions and all budgets remain unchanged.

Qualification:

- Native V5, V6 and V8 each passed all 441 cases in the same three complete
  original suites: 351 Apps, 79 packages and 11 activation. The 15 new cases and
  all 426 original cases passed on actual migrated PostgreSQL and actual Native
  ArtifactSandbox as UID 1004 without network. Native V8 froze HEAD
  0990c3dd386b5a8c3f8602e22f41073e7337655f plus the follow-up, Source SHA256
  9a8382ca107e6f82741259ae035d0ed575a248a594b8dc39d02fde73fd24f407.
- Shared/DB builds and the original full server type command passed in Types V8.
  Types V11 passed the original full UI type command after completing the owned
  test OAuth reply and correcting accessible headings/regions/statuses.
- Focus V3 passed 189 cases in six complete files, including all 164 original
  AppsConnect cases. Focus V4 passed the 10 consent/transport/contract cases.
- Browser V7 passed both complete built browser cases, including the unchanged
  original connection-continuation case: all eight fields, keyboard C3/default
  Cancel focus, narrow layout, full axe checks, unknown-reply/manual original
  receipt recovery, no automatic POST on reload and separate withdrawal.
- Types V11 and Browser V7 have matching before/after Source SHA256
  d5db100b2f2455fddf3b005ffa2db6f4c1958721a8bfadddd661e4cf825818a2.
  Compared with the Native V8/server-type source, only the owned UI OAuth test,
  consent component accessibility and its browser region selector changed.
  Reconstructing those three public files reproduces the exact Native V8 hash;
  Native/server/Shared/DB and every Native test file remain byte-identical.
  This records incremental qualification, not a claim that different complete
  source hashes are identical.

Retained failed runs: Native V4 passed 440/441, exposing the original recommended
OAuth defaults' all-Agent reach in the new purpose mode; that original helper
now retains zero specific Agent access. Types V5 found the already-narrowed
archive-date expression, then Types V6 and V8 found the incomplete owned OAuth
test reply. Native V7 reached no cases because its new external prerequisite
file lacked group read permission; only that owned prerequisite was repaired.
Browser V5 found heading order/duplicate region labels; V6 passed the new consent
case but exposed multiple urgent alerts for ordinary unavailable per-connection
reviews. Those now use visible polite statuses; failed user decisions retain
their alert. The unchanged original browser assertion passes in V7. No axe rule,
assertion, original deadline, policy gate or authority check was removed.

This qualification covers newly allocated managed Google personal connections
with deferred Agent access. Existing-connection purpose adoption, revalidation
after credential rotation, preserving existing reach, purpose replacement after
withdrawal, promotion, representative Safe Test, hosted Free Core/funding and
first value remain separate unfinished work. Generated provider statements are
English; labels and controls have English/Danish translations. No real provider,
human assistive-technology pilot, deployed consent, full V9 or PR readiness is
claimed. Continue the complete implementation.


Native V4 retained 440 passes / 441 with only the new managed callback failing.
Its original recommended-access helper selected all Agents for this managed
method. Follow-up source resolves the actual Native onboarding purpose in that
helper and passes the existing empty specific-access choice, while ordinary
Apps/task defaults stay unchanged. Types V4 did not start; V5 must verify this
last callback boundary without weakening the zero-Agent Native guard.


Native V5 passed all 441 cases / three complete owner suites, including the
positive managed callback and all original first-result assertions. Its frozen
Source SHA256 was e3d14fb64205e97823a7d292ce5b68cfb113e530363af405a257f8f90cc96ebc
at HEAD 0990c3dd386b5a8c3f8602e22f41073e7337655f, matching before/after.
Types V5 Shared/DB builds passed, but the original server compiler rejected an
optional date call after that date had already been narrowed to null by the
archive refusal. The current correction hashes the already-established null;
Native V6 and Types V6 must qualify it. UI types and built browser did not start.
No provider/human/GA qualification or complete V9/PR readiness is inferred.
