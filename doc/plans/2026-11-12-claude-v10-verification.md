# Blentera V10 verification with Claude Code

Started 2026-11-12. Continues the Codex work on draft PR #42 (`codex/blentera-v10`).
This is the status ledger for the Claude Code verification pass. Earlier history stays in
`2026-10-22-blentera-v10-recovery.md` and the dated evidence READMEs.

## Goal and decisions

- Target: the brief's **full V10 beta entry gate** (§47, brief lines 7507-7548), not a limited pilot.
- Work lands as small PRs into `codex/blentera-v10`. PR #42 stays the integration PR into `master`.
- New verification results go here or into short dated summaries, with bulky output kept in CI
  artifacts. No new folders under `doc/operations/aw-v10-evidence/`.
- Models: Opus for planning, root causes and audits; Sonnet for fixes with a clear repro;
  Haiku or Sonnet for search and logs; Fable only when Opus has failed twice (see `CLAUDE.md`).

## Starting point (head `ad190a71`, checkpoint R94)

- Requirement register: all 169 rows open.

  | Status | Rows |
  |---|---|
  | `partial_implementation_open` | 81 |
  | `no_scoped_evidence_located_open` | 39 |
  | `current_bounded_work_open` | 22 |
  | `historical_partial_evidence_open` | 17 |
  | `implemented_unqualified_open` | 10 |

- CI on the head is red. Run 43126861208:
  - about 20 of 31 managed-Native shards fail;
  - chat 1/3 and 2/3 fail, and workspaces-a 2/2 fails;
  - e2e fails.
- Run 43126861295:
  - routes-1 fails;
  - server-1 to server-4 are cancelled at the 60-minute limit;
  - changed-source security regressions and coverage fail.
- Hosting gaps:
  - public signup is closed (`deploy/v6/saas.env.example`);
  - there is no email provider;
  - billing is Paddle;
  - backups are off by default;
  - there is no Sentry DSN and no OTel configuration;
  - live UpCloud evidence is still required (`infra/README.md`).

## Phases

| Phase | Scope | Status |
|---|---|---|
| 0 Setup | `CLAUDE.md`, reference indexes, `pb-*` router skills, test environment | Done (#43) |
| 1 Triage | Cluster every failing CI job by root cause; rank by jobs fixed | Done (see failure ledger) |
| 2 Green CI | Fix one cluster per PR until `verify`, serialized, security and e2e pass | In progress (#44, #45, #47–#50 merged) |
| 3 Risk audits | Authority, privacy, data loss and migrations, spend, recovery, supply chain | Open |
| 4 Requirements | Walk the 169 rows, P0 to P2; update register status | Open |
| 5 UI/UX | §33 screens and §41 journeys in EN/DA; accessibility, critique, copy | Open |
| 6 Hosting | Signup and email, Paddle, backups, Sentry/OTel, secrets, UpCloud staging | Open, needs owner decisions |
| 7 Qualification | §55 release record, matrix, preflight and audit on staging | Open |

## Phase 0 record

- `scripts/build-reference-index.mjs` writes heading indexes for the 39 playbooks
  (`doc/reference/aw-v9/playbooks/index/`) and the V10 brief (`doc/reference/blentera-v10/index.md`).
  `--check` fails when an index is stale. Re-running it produced no diff.
  `scripts/__tests__/build-reference-index.test.mjs` (5 tests) runs in `pr-trusted.yml` and fails CI when an index is stale.
- Router skills in `.claude/skills/`: `pb-security-privacy`, `pb-data-api-backend`, `pb-agentic-ai`,
  `pb-verification-reliability`, `pb-ui-ux-writing`. `doc-maintenance` is linked from `.agents/skills`.
  `check-pr` and `deal-with-security-advisory` are not linked, because they assume the `gh` CLI and
  upstream Paperclip review tooling.
- `.claude/launch.json`: removed the `cloud-web` entry. It pointed to a path outside this
  repository on another machine.
- Local checks in the cloud container, using Node 24:

  | Check | Result |
  |---|---|
  | `pnpm install --frozen-lockfile` | Exit 0. It warned about missing `dist` bins for unbuilt packages. |
  | `pnpm check:token-gates` | All gates clean |
  | `pnpm check:customer-brand` | 0 leaks |
  | `server/src/__tests__/access-service.test.ts` as user `ubuntu` | 30/30 passed |

  Run as root, the same server test file reported 30 skipped. Embedded Postgres does not start
  as root, so a skipped-only run does not count as verification. `CLAUDE.md` records the
  working setup.

## Failure ledger (CI on PR #42 head `ad190a71`, updated 2026-11-12)

45 jobs failed and 15 were cancelled. Clusters, ranked by how many jobs a fix could turn green:

| Cluster | What fails | Jobs | Status |
|---|---|---|---|
| A1. Managed OpenCode relay credential | The sandbox-relay route in `managed-native-opencode-e2e-fixture.ts` required a Bearer token that nothing sends (OpenCode sends only the placeholder that OpenShell normally replaces). Result: `scheduler_software_host_incoming_model_authority_invalid`, `providerResponses=0` | Shards that use `runManagedNativeOpenCodeFixture` (6 files, for example shards 4 and 19) | Fixed in the fixture (#47). Local: project-create 2/2 passed. CI shard 19 now passes this step |
| A2. Runner stalls at `run.prepare` | The run stops after `native.process_start_requested`, then `run.prepare` times out (`native_session_interrupted`) | Probably most serial heartbeat-fixture files and the close-source fixture (shards 6, 7, 8, 18), plus the second journey of payload-temporal | Root cause found: in `direct_outbound` mode the 30 s `run.prepare` deadline started before remote staging finished. Fixed in production (#48) |
| A3. Conversation-frame lease | `scheduler_software_host_unique_active_lease_required`: each agent's Host is created after the run takes its lease | Shard 10 (runtime-skills) | Lease part fixed in the fixture (#50). CI confirms the lease error is gone; the run now fails in preparation (see S2/A3b) |
| A4. Progress conversation | Run fails with `providerCallCount 0`: the frame preferred the strict authenticated model route, whose token matches only when minted in the same second | Shard 2 | Model route fixed in the fixture (#50). CI: 2 of 5 cases pass (0 before); the other 3 reach `providerCallCount` 1, see A4b |
| A3b. Serial Host artifact pin | `serial_model_original_artifact_pin_invalid`: the lazily created serial Host rejects the signed launch, because the Run pinned the provider-pack install root before this Agent's Host image home existed | Shard 10, browser lanes | Same cause as S2. Conversation Runs never record artifact authority (`native-session-executor.ts:15215`), and since `75d90c4e` the browser fixtures use the serial Host, which requires it. Changing which Runs record artifact authority is an authority decision: Phase 3 authority audit, together with C2 |
| A4b. Progress comment source seal | `report_progress` returns "Managed progress comment source seal could not be retained": the seal UPDATE in `paperclip-runner-tool-authority.ts` matches no row, so the gateway rejects the next call | Shard 2 | Open |
| B. Mocked legacy and Native fixtures | The paid-transport guards (brief §57.6 RT-03) deny the mocked `codex_local` and Native `codex` test doubles with `paid_transport_unqualified` | Serialized 1/9, several server shards | Fixed for 9 files in #44 and #45. Local result: 71 failures fell to 9. The 9 that remain have other causes (see A-local) |
| A5. Checkpoint deadline | `managed_opencode_checkpoint_deadline_exhausted` in session resumption | Managed Native 18 | Open, not diagnosed |
| A-local. Native fixture remainder | `native-session-resumption`: completion contract is `undefined` (3 cases). `heartbeat-process-recovery`: task root/cwd, accepted-interaction retry counts, paused-recipient successor (5 cases). `heartbeat-stale-queue-invalidation`: accepted queue after the Native owner finished (1 case) | Serialized 1/9, server shards | Open |
| G2. Durable chat retry fixture | `durable-chat-wakeup.test.ts`: `durable_retry_fixture_sdk_initialization_hook_not_exhausted`, 11 cases | Server 8/12 | 8 of 11 fixed in the fixture (this PR): per-test paid-transport opt-in; the scenario restores the instance `experimental` flags that the managed fixture leaked; the Slack endpoint finishes setup. The other 3 are C2 |
| C. Chat channel source authority | Discord `metadata_only` update assertion; `chat-channels.integration.test.ts:26337` direct external-chat finals (paid-transport denial of a mocked adapter) | Chat 1/3, 2/3 | Discord case already passes on `b397547e`. `:26337` fixed with a per-test opt-in (this PR); whole file 1052/1052 locally |
| C2. Slack channel conversation authority | RuntimeControl (`server/src/services/runtime/control.ts:572`, `:4574`) treats a Run as a conversation only when it has `conversationAgentId`/`conversationUserId`. Slack `chat_channel` tasks have neither, so workspace preparation goes through the Worker checks and is denied. Also, nothing outside the database sets `externalExecutionPolicy: "agent"` for Slack | 3 `durable-chat-wakeup` cases, `heartbeat-managed-chat-dispatch-boundaries` (4), `heartbeat-managed-chat-workspace-root` (1), `native-opencode-managed-channel-conversation` (1), managed Native 6 and 30 | Open. Needs an authority design (brief L3404-3480, multiplayer semantics): Phase 3 authority audit |
| D. Generic server shards | Server 9/12: `heartbeat-responsible-user-invariant`, `heartbeat-workspace-busy` and `heartbeat-worktree-suppression` were the same paid-transport denial as B (15 tests) | Server 2, 9, 10, 11, 12 | Server 9/12 fixed (#49). This PR: `heartbeat-runtime-skills` (server 12, paid-transport opt-in) and `v9-feedback-images` (server 2, stale error codes; now the typed codes from `offboarding.ts:45,436,517`). Server 10 passes. Server 11 hits its 20-minute shard timeout (see T) |
| D2. Failures hidden by the server 11 timeout | `email-channels.integration.test.ts`, `heartbeat-native-cleanup-admission.test.ts`, `tool-gateway.test.ts` (30 s timeout). Seen once, when the shard finished on #50 | Server 11 | Open |
| D3. Workspace runtime port timeout | `workspace-runtime.test.ts:7385`, listener ownership unavailable: 20 s test timeout | Server 2 | Open |
| E. UI unit test | One button-query assertion (`AgentModelMigrationMonitor.test.tsx`) | Workspaces-a 2/2 | Resolved: passes on `b397547e` without changes |
| F. Playwright e2e | `signoff-policy.spec.ts:484`, `:579`: a test race. The PATCH that hands the issue on cancels a legacy Run still in setup, which leaves a reconciliation hold that blocks the next Run. `aw-v9-account-security.spec.ts:96`: the spec predates the receipt-access step (`ui/src/api/saas.ts:521`). `task-reload.spec.ts:46`: intermittent. The managed specs are S1 | 6 shards | Signoff fixed in the spec (this PR, local 20/20): it waits for issue Runs to settle before each hand-off. Account-security spec update open |
| F3. Hold after cancelling a Run in setup | Cancelling a running legacy Run before its process starts records `legacy_execution_requires_reconciliation`, though no provider work began | — | Open. Production recovery gate: Phase 3 recovery audit |
| S1. Tool schema dialect | `session.open` failed with `no schema with key or ref "http://json-schema.org/draft-07/schema#"`. Since `fdd850d9`, assigned app tools reach the OpenCode tool bridge, Railway schemas declare draft-07 (`server/src/services/railway.ts:95`), and both bridges compiled every schema with a 2020-12-only validator | e2e managed-connection-review, `connection-intents`, `mcp-user-stories`; probably more managed lanes | Fixed in production (this PR): `packages/paperclip-runner/src/drivers/tool-input-schema-validator.ts` compiles each schema with its declared dialect; other dialects still fail closed. Runner tests 23/25 before, 25/25 after. The e2e fixtures also get a 300 s run budget, because preparation used most of the 180 s lease |
| S4. Model socket observer memory bound | After S1, the first model call fails `managed_native_model_transport_observation_failed` with `socketOwnerFailurePhase: response_shape`. The privileged CI observer (`scripts/fixtures/native-model-socket-observer.mjs`) reports `memory_bound` when its own VmHWM exceeds 80 MiB, but the fixture rejected any peak above 80 MiB as an unknown shape before reading the stage. The CI self-check on the same runners measures an idle peak of about 70.9 MB against the 83.9 MB bound; locally, scanning 120k file descriptors adds about 11 MB, almost all file-backed pages of V8's optimizing compilers (RssFile +5.4 MB; the heap grows 2 MB) | e2e managed-connection-review, `connection-intents:204`, `mcp-user-stories:288`; probably `signoff-policy:581`, `pipelines-tutorial-flow:326` | CI fixture fix (this PR): the launcher runs the observer with `--jitless` (local peak under the same load 61.4 MiB to 50.4 MiB, about the idle level); the 80 MiB bound and the scan are unchanged. The fixture now classifies an over-bound report as `observer_incomplete`/`memory_bound` and still never accepts it. Hash pins updated. Transport tests 6/6 before, 8/8 after. Needs a CI run to confirm |
| H. Product browser, agent chat | Unknown. A 110 MB failure artifact | 1 | Open |
| F2. e2e onboarding cleanup | `aw-v9-onboarding-permission-consent.spec.ts:286`: cleanup `DELETE /api/companies/:id` returns non-OK (first seen on #47; passed on base) | e2e 8/8 | Open |
| T. Repository tests server-1 to server-4 | Hit the 60-minute timeout | 4 | Open |

The Codex notes said many Native jobs died during sandbox or bwrap install. The logs do not show this.

## Decisions taken (2026-11-12)

The owner delegated all technical and product decisions to the verification lead (Claude).
These are the defaults. A later decision that changes one updates this table.

| Topic | Decision | Reason |
|---|---|---|
| Hosting | Keep UpCloud plus HCP Terraform (`deploy/v6`, `infra/`). Staging first, then production. | Already built, EU (Copenhagen/Finland), matches the brief. |
| Billing | Keep Paddle. | Paddle is merchant of record: it collects and pays EU VAT for us. Already integrated. |
| Email | Add a provider-neutral transport for the existing email outbox. Pick an EU-based provider in Phase 6. | The outbox exists (`server/src/services/saas/auth-delivery.ts`) but no mail is sent. An EU provider keeps the "EU hosted" claim honest (LOCK-1029). |
| Public signup | Open only after email verification, abuse limits and Phase 3 audits pass. | Signup without verified email is the main abuse path. |
| Repository visibility | Stay public during development, and make sure that it contains no secrets or customer data. Review before launch. | Public repositories get free GitHub Actions minutes. One full CI run is about 100 jobs. |
| Service owner | The repository owner is the named service owner. Claude prepares the runbooks. | The beta gate requires a named owner. |
| Product claims | Claim only what has verified evidence. Claude drafts the claims, privacy policy and subprocessor list from the code. A lawyer reviews them before launch. | LOCK-1028 and LOCK-1030. Claude is not a lawyer. |
| Usability evidence | Claude writes the test scripts. The owner runs about 5 short sessions with real people before beta. | The beta gate requires human first-value evidence. |
| Skills | Copied `web-design-guidelines` (rules pinned in `guidelines.md`, not fetched at run time) and `playwright-best-practices` into `.claude/skills/`, with MIT licences and source commits. Phase 3 uses the built-in `security-review` instead of the third-party Trail of Bits plugin. | Skills installed on a local machine do not reach cloud sessions. Instructions fetched at run time could change without review. |

## Things the owner will be asked to provide (only when the phase needs them)

| When | What |
|---|---|
| Phase 2-3 | An Anthropic API key, added as a GitHub Actions secret, for the live provider tests. |
| Phase 6 | Accounts: UpCloud, HCP Terraform, Paddle (sandbox first), an email provider, Sentry. The domain name. Company name and address for legal pages. |
| Phase 6 | Slack and Microsoft Teams app registrations, with steps written by Claude. |
| Before beta | A lawyer's review of the privacy policy and terms. About 5 people for short usability sessions. |
