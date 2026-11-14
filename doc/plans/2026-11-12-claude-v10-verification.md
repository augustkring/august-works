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
| 2 Green CI | Fix one cluster per PR until `verify`, serialized, security and e2e pass | In progress (#44, #45, #47–#53 merged) |
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
| A-local. Native fixture remainder | `heartbeat-process-recovery` (5): the paid-transport guard also denied the Native `codex` candidate, the tsx recovery worker is out of `vi.mock`'s reach, and channel fixtures lacked the linked-Human source required since `fdd850d9`. `heartbeat-stale-queue-invalidation` (1): the fixture lacked the physical cleanup proof required since `79a1b95c`. `native-session-resumption` (3): the launch guard denied the test-factory backend | Serialized 1/9, server 6, server 8 | 7 of 9 fixed in fixtures (this PR). New helper `installMockedLegacyDispatchInChild` carries a test's opt-in into the worker. Local: recovery 305/305, stale-queue 50/50, resumption 11/13. The other 2 are R1 |
| R1. Local lease cleanup proof | The local driver's `releaseRunLease` (`server/src/services/environment-runtime.ts:1228`) leaves `cleanup_status` NULL, but `nativeOwnerReleaseHasCleanupProof` (`server/src/services/native-owner-release.ts:81`) requires `"success"`. The cleanup index (`packages/db/src/schema/environment_leases.ts:40-45`) treats NULL as clean for a released local lease. So on local environments a deferred successor of a finished Native Run is never promoted (`wake-queue/adapters/postgres.ts:1126`) | `native-session-resumption` newer_active, stale_idle | Open, high priority. A production recovery gate: Phase 3 recovery audit. Suggested direction: accept the cleanup index's NULL semantics for released local leases that have no provider lease, with a regression test |
| A6. Interaction retry model settlement | `heartbeat-managed-native-interaction-retry` (2 cases) failed with `worker_model_unsettled`. The test read the plan revision in `beforeProviderResponse`, but the fixture calls `providerReply` first (`managed-native-heartbeat-fixture.ts:487` vs `:522`). So call 2 threw, the predecessor Run failed, and the retry got 409 (`worker-model-gateway.ts:3411`) | Managed Native | Fixed in the test (this PR): it reads the revision in `beforeManagedModelRequest`. Both cases now pass the predecessor and fail later at line 164 on **A6b, to the Phase 3 authority audit:** the continuation Run gets no bootstrap source closure. (1) `accepted-plan-review-source.ts:74-79` finds the Run by `nativeIssueId`, which is still null at bootstrap capture (`heartbeat.ts` ~24571; set at ~25048). (2) `exactNativeTaskContinuation` (`native-execution-input.ts:404-406`) needs a message or origin comment, and accepting a plan without a comment has neither. The project-workspace and session-resumption plan-accept cases probably share it |
| A7. Model reservation fixture drift | `v7-model-reservations`: once Runs completed (after S1), the fixture expected 2 context bundles instead of the instruction bundle plus 2 skills, and the Host eraser was passed as a 7th argument that the helper drops | Managed Native 20 (cancelled before #51) | Fixed in the fixture (this PR). Not verified locally: the Run does not settle in the container. CI is the check |
| G2. Durable chat retry fixture | `durable-chat-wakeup.test.ts`: `durable_retry_fixture_sdk_initialization_hook_not_exhausted`, 11 cases | Server 8/12 | 8 of 11 fixed in the fixture (this PR): per-test paid-transport opt-in; the scenario restores the instance `experimental` flags that the managed fixture leaked; the Slack endpoint finishes setup. The other 3 are C2 |
| C. Chat channel source authority | Discord `metadata_only` update assertion; `chat-channels.integration.test.ts:26337` direct external-chat finals (paid-transport denial of a mocked adapter) | Chat 1/3, 2/3 | Discord case already passes on `b397547e`. `:26337` fixed with a per-test opt-in (this PR); whole file 1052/1052 locally |
| C2. Slack channel conversation authority | RuntimeControl (`server/src/services/runtime/control.ts:572`, `:4574`) treats a Run as a conversation only when it has `conversationAgentId`/`conversationUserId`. Slack `chat_channel` tasks have neither, so workspace preparation goes through the Worker checks and is denied. Also, nothing outside the database sets `externalExecutionPolicy: "agent"` for Slack | 3 `durable-chat-wakeup` cases, `heartbeat-managed-chat-dispatch-boundaries` (4), `heartbeat-managed-chat-workspace-root` (1), `native-opencode-managed-channel-conversation` (1), managed Native 6 and 30 | Open. Needs an authority design (brief L3404-3480, multiplayer semantics): Phase 3 authority audit |
| D. Generic server shards | Server 9/12: `heartbeat-responsible-user-invariant`, `heartbeat-workspace-busy` and `heartbeat-worktree-suppression` were the same paid-transport denial as B (15 tests) | Server 2, 9, 10, 11, 12 | Server 9/12 fixed (#49). This PR: `heartbeat-runtime-skills` (server 12, paid-transport opt-in) and `v9-feedback-images` (server 2, stale error codes; now the typed codes from `offboarding.ts:45,436,517`). Server 10 passes. Server 11 hits its 20-minute shard timeout (see T) |
| D2. Failures hidden by the server 11 timeout | `heartbeat-native-cleanup-admission` (paid-transport opt-in), `tool-gateway` (GW1), `email-channels` (C2b) | Server 11 | Cleanup-admission and tool-gateway fixed (this PR). Email is C2b |
| C2b. Email conversations cannot send | `email-channels.ts:1326` opens `chat_channel` issues woken by a system actor. Since `fdd850d9`, `assertNativeConversationToolNoPlanScope` (`native-tool-boundary.ts:146`) requires a linked Human, so `agentmail_send` is denied in production | `email-channels.integration.test.ts` | Open. Authority design, together with C2: Phase 3 authority audit |
| GW1. Rate-limit self-rejection | The dispatch re-check in `executeRemoteHttpTool` peeks the counter with `count >= limit` and counts the call's own token (`tool-access-policy.ts:1083`), so with limit N the Nth call rejects itself | `tool-gateway.test.ts`, `tool-gateway-connector-telemetry.test.ts` | Fixed in production (this PR): a server-internal token ledger, keyed by policy, bucket and window, lets only the consuming call's re-checks subtract its own token. Pre-checks and approved paths stay strict, and window rollover gives no credit. Local: 84/84 and 8/8, plus a new regression test |
| GW2–GW4. Rate-limit follow-ups | GW2: approved executions take no token at execution time, so depending on policy order they reject themselves or are not counted. GW3: the board-only `POST /companies/:id/tools/policy/test` accepts `consumeRateLimit`. GW4: the re-check returns 403 `rate_limited` while admission returns 429 | — | Open. Phase 3 spend audit |
| D3. Workspace runtime port timeout | `workspace-runtime.test.ts:7385`, listener ownership unavailable: 20 s test timeout | Server 2 | Open |
| E. UI unit test | One button-query assertion (`AgentModelMigrationMonitor.test.tsx`) | Workspaces-a 2/2 | Resolved: passes on `b397547e` without changes |
| F. Playwright e2e | `signoff-policy.spec.ts:484`, `:579`: a test race. The PATCH that hands the issue on cancels a legacy Run still in setup, which leaves a reconciliation hold that blocks the next Run. `aw-v9-account-security.spec.ts:96`: the spec predates the receipt-access step (`ui/src/api/saas.ts:521`). `task-reload.spec.ts:46`: intermittent. The managed specs are S1 | 6 shards | Signoff fixed in the spec (this PR, local 20/20): it waits for issue Runs to settle before each hand-off. Account-security spec update open |
| F3. Hold after cancelling a Run in setup | Cancelling a running legacy Run before its process starts records `legacy_execution_requires_reconciliation`, though no provider work began | — | Open. Production recovery gate: Phase 3 recovery audit |
| S1. Tool schema dialect | `session.open` failed with `no schema with key or ref "http://json-schema.org/draft-07/schema#"`. Since `fdd850d9`, assigned app tools reach the OpenCode tool bridge, Railway schemas declare draft-07 (`server/src/services/railway.ts:95`), and both bridges compiled every schema with a 2020-12-only validator | e2e managed-connection-review, `connection-intents`, `mcp-user-stories`; probably more managed lanes | Fixed in production (this PR): `packages/paperclip-runner/src/drivers/tool-input-schema-validator.ts` compiles each schema with its declared dialect; other dialects still fail closed. Runner tests 23/25 before, 25/25 after. The e2e fixtures also get a 300 s run budget, because preparation used most of the 180 s lease |
| S4. Model socket observer memory bound | After S1, the first model call fails `managed_native_model_transport_observation_failed` with `socketOwnerFailurePhase: response_shape`. The privileged CI observer (`scripts/fixtures/native-model-socket-observer.mjs`) reports `memory_bound` when its own VmHWM exceeds 80 MiB, but the fixture rejected any peak above 80 MiB as an unknown shape before reading the stage. The CI self-check on the same runners measures an idle peak of about 70.9 MB against the 83.9 MB bound; locally, scanning 120k file descriptors adds about 11 MB, almost all file-backed pages of V8's optimizing compilers (RssFile +5.4 MB; the heap grows 2 MB) | e2e managed-connection-review, `connection-intents:204`, `mcp-user-stories:288`; probably `signoff-policy:581`, `pipelines-tutorial-flow:326` | CI fixture fix (this PR): the launcher runs the observer with `--jitless` (local peak under the same load 61.4 MiB to 50.4 MiB, about the idle level); the 80 MiB bound and the scan are unchanged. The fixture now classifies an over-bound report as `observer_incomplete`/`memory_bound` and still never accepts it. Hash pins updated. Transport tests 6/6 before, 8/8 after. Needs a CI run to confirm |
| S5. Approval gate fenced the plan | After S4, an assigned tool call that needs Human approval records its pending invocation and returns 409 `approval_required`. `withOrchestrationNativeTool` (`native-tool-boundary.ts`) treated that as an unknown outcome and fenced the plan (paused, version bump, Human escalation). The Run's next model call then failed `planRunning`/`planVersionMatches` (`worker-model-gateway.ts:1937`) | e2e managed-connection-review, `connection-intents`, `mcp-user-stories`; probably the 3 e2e Runs that never settle in the same shards (signoff `:478`, `acp-stop-continuation`, `legacy-failure-continuation`) | Fixed in production (this PR): no fence when the exact pending invocation is durably recorded (company, Run, agent, issue, tool, key, `awaiting_approval`, `pending`, no result). Everything else still fences. 3 regression tests; the first fails without the fix. Local: worker-gateway 83/83, assigned MCP and tool-authority 69/69 |
| S6. Mixed-case fixture issue prefix | After S5, the managed decline Run now `succeeded`, but the page polled `GET /issues/H6e7292b-1/interactions` and got 404 until the spec timed out. `seedV5Companies` inserted prefixes from a lowercase UUID slice. Identifier routes upper-case the identifier before lookup (`issues.ts` `getIssueByIdentifier`), and production prefixes are always upper case (`deriveIssuePrefixBase`) | e2e managed specs that use `seedV5Companies` | Fixed in the fixture (this PR): prefixes are upper-cased. Local: v7-readiness plus account-deletion-saml 10/10 |
| S7. Continuation tool-result receipts | After S5 and S6 the managed decline Run succeeds. The continuation Run then fails setup with a 403 at `worker-model-gateway.ts:784`, "Managed OpenCode tool result has no original qualified invocation receipt". The provider history carries the earlier Run's approval-gated tool_result, but this Run's profile has no capture or association for it. Probably the same family as A4b | e2e managed-connection-review, `connection-intents`, `mcp-user-stories`, signoff comment-required | Open. Authority provenance across Runs: needs an Opus investigation |
| F4. Long-session soak | `aw-v9-long-session.spec.ts:10` sometimes runs past its 240 s test timeout | e2e 8 | Open, intermittent (2 of 4 recent runs) |
| F6. Pipelines board item visibility | `pipelines-tutorial-flow.spec.ts:476`: an item is not visible within 5 s after reload. It runs right after the managed `:326` case, which now runs much further | e2e 7 | Open. Recheck after S7; probably starvation |
| WB. Comment wake batching | `heartbeat-comment-wake-batching` (21 of 29 failing, about 340 s): the paid-transport guard denied the mocked `process`/`openclaw_gateway` adapters, and the parked chat-source fixture lacked cleanup proof | Server shards | Fixed in the fixture (#53). Local: 29/29 in about 57 s |
| C3. Discord comment order | `chat-channels.integration.test.ts:53337` compared ids from a query with no ORDER BY | Chat 1/3 (intermittent) | Fixed in the test (#53): both queries order by id |
| D4. Concurrent conversation reopen race | `analytical-context-privacy.integration.test.ts:839`: of 6 concurrent POSTs that should reopen one source conversation, 2 returned 404 | Server 6 (seen once, on #52) | Open, intermittent. Phase 3 data/recovery audit |
| T2. Shard timeouts hide results | Shards are cancelled at the 20-minute `general_tests` limit (`pr-trusted.yml:541`), and the set changes per run (on #52: server 5, 7, 8, 12; managed Native 1, 13, 20) | — | Fixed (#53): every plain server shard finished in 8–14 min on #53's run. Durations refreshed from 3 CI runs (the old manifest was 2.7x low), plain server group raised from 12 to 18 shards (predicted about 12.5 min each), managed Native timeout raised from 20 to 30 min, because its shards are single files |
| P1. Process adapter fixtures hidden by timeouts | `heartbeat-task-drain-admission-release` (2 of 3), `heartbeat-local-environment` (2 of 2) and `agent-conversations` (2 of 46) fail with `paid_transport_unqualified` for the real `process` adapter. They showed up once #53's shards finished | Server 4, 5, 14 | Fixed in the fixtures (this PR): per-file opt-in through the shared helper. Local: 3/3, 2/2, 46/46 |
| DC1. Installed Native text draft controller | `heartbeat-dependency-draft-controller.integration.test.ts`: 11 of 32 failing. `57909d18` added an early chat-control check for fresh automation Native runs (`heartbeat.ts` ~23917). It runs while the Run is still `legacy`, it is now the first gate to use up the admission marker, and it sets the stage to `dispatching` before Native selection | Server 3 | 6 fixed in the fixture (this PR): hooks act only on the Native-selected dispatch, and the marker cases expect the earlier fail-closed point. The full file in CI order also needed longer first-dispatch waits (10–20 s raised to 30 s, test limits to 120 s), because dispatch slows as earlier cases fill the database (PERF1). Local, whole file: 21/32 before, 27/32 after. **DC1b, 5 cases, to the Phase 3 recovery audit:** (1) Stop records `beforeNativeSelection` only when the stage is `preparing` (`heartbeat.ts` ~30628), so a Stop after the early check gets no settlement receipt and continuation fails closed (`cancelled-native-startup.ts:16-19`). (2) After Stop, a cancelled in-process turn writes no `native.in_process_backend_settled` event (`native-session-executor.ts` ~12691), and a never-admitted local lease ends `expired` with null `cleanupStatus`. So `nativeOwnerReleaseHasCleanupProof` (`native-owner-release.ts:81-91`) never releases the Task owner, and plan creation returns 409. Same family as R1 |
| MS1. Managed signoff API policy | `managed-signoff-api-policy.integration.test.ts`: 3 failing. (a) The controlled signoff backend stamped events with its turn id; the control-plane port accepts only the Run's `runner_instance_id` (`paperclip-control-plane-port.ts:232-235`) | Server 2 | (a) fixed in the helper and test (this PR). The e2e fixtures `managed-signoff-comment.ts` and `managed-pipeline-producer.ts` use the same helper and still need it. Still 0/3; remaining causes go to Phase 3. **MS1b, recovery:** an injected backend never gets a remote asset locator, so `native_process_cleanup_pending` never clears and the owner release blocks the Reviewer wake (`native-owner-release.ts:84`; same family as R1, DC1b). **MS1c, authority:** a plan-less issue Run has no model authority (RuntimeControl falls back to `issueForRun`, 403 at `worker-model-gateway.ts:2601`), and an execution-policy Reviewer cannot be the plan worker (`orchestration-admission.ts:88`). **MS1d, HIGH, data contract:** the review binding requires `sha256:`-prefixed `sourceResultCanonicalSha256` (`packages/shared/src/worker-model-gateway.ts:28`, `native-payload-source-snapshot.ts:80,90`, migration 0576 CHECK), but `native_run_results.canonical_sha256` is plain hex (`canonical.ts:18`), and the 0576 trigger compares the two directly. No review-model reservation can be inserted, so Native review qualification cannot succeed. Introduced in `57909d18`. Recommended: one format (plain hex) in the 3 validators and a new migration replacing the CHECK; then add `review_model` to the fixture host map (`managed-native-heartbeat-fixture.ts:906`) |
| A4b. `report_progress` source seal | The progress comment's source seal is not retained (`paperclip-runner-tool-authority.ts` ~1750). Partial finding: `issueService.addComment` drops a caller's requested source protocol 1 when the caller's transaction is also the service handle (`issues.ts` ~13889), so the same-transaction seal finds no unsealed row. A local fix gets the seal past that check. The gateway's receipt-policy comparison (`worker-model-gateway.ts` ~1289) then rejects it, and 3 of 5 cases still fail | Managed Native (progress conversation) | Open. Both changes touch comment-source authority, so they go to the Phase 3 authority audit with S7 (diff kept outside the repo) |
| F7. Runtime-unavailable notice hidden | `legacy-failure-continuation.spec.ts:19`: the "Task paused — runtime unavailable" notice exists in the page but is reported hidden | e2e 7 (2 of the last 4 runs) | Open, intermittent |
| F5. e2e starvation behind managed cases | `signoff-policy.spec.ts:637` (and earlier `:478`): no issue-bound Run becomes available while the 12-minute managed "always" case holds the shard's heartbeat queue | e2e 1 | Open. Expected to clear with S7 |
| T3. Single files that never finish | `heartbeat-managed-scheduler` is cancelled at 30 minutes on #53; `v7-model-reservations`, `native-opencode-managed-conversation-frame` and `native-opencode-managed-browser-source-invalid` run past 25 minutes | Managed Native | Open. Check for hangs before raising limits |
| PERF1. Dispatch slows as the database grows | In `heartbeat-dependency-draft-controller`, the first model dispatch of a fresh Task takes under 5 s alone but about 25 s after a dozen earlier cases in the same database. Each case seeds its own company, so some dispatch-path query probably scans across companies or lacks an index | Server 3 (only test waits) | Open. Profile the preparation path in the Phase 3 data audit; it matters for 100–1000 customers |
| CF1. Conversation frame Stop | `native-opencode-managed-conversation-frame` finished for the first time under the 30-minute limit (about 24 min): 4 of 11 fail. Two cases get 403 from Human Stop on a conversation Run. One expects `receipt` and gets `worker_completed`. One has a Stop-race field mismatch | Managed Native | Open. The Stop 403 looks like the conversation-authority family (C2): Phase 3 authority audit |
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
