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
| 2 Green CI | Fix one cluster per PR until `verify`, serialized, security and e2e pass | In progress (#44, #45 merged) |
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
| A. Managed Native/OpenCode | Runs end `failed` / `adapter_failed` while preparing. Seen: `scheduler_software_host_incoming_model_authority_invalid` (`server/src/__tests__/helpers/managed-native-conversation-sandbox-host.ts:719`), `managed_opencode_checkpoint_deadline_exhausted`, `managed_close_source_real_native_run_not_successful` | 9 verified, up to 24 | Open, next |
| B. Mocked legacy and Native fixtures | The paid-transport guards (brief §57.6 RT-03) deny the mocked `codex_local` and Native `codex` test doubles with `paid_transport_unqualified` | Serialized 1/9, several server shards | Fixed for 9 files in #44 and #45. Local result: 71 failures fell to 9. The 9 that remain have other causes (see A-local) |
| A-local. Native fixture remainder | `native-session-resumption`: completion contract is `undefined` (3 cases). `heartbeat-process-recovery`: task root/cwd, accepted-interaction retry counts, paused-recipient successor (5 cases). `heartbeat-stale-queue-invalidation`: accepted queue after the Native owner finished (1 case) | Serialized 1/9, server shards | Open |
| G2. Durable chat retry fixture | `durable-chat-wakeup.test.ts`: `durable_retry_fixture_sdk_initialization_hook_not_exhausted`, 11 cases | Server 8/12 | Open |
| C. Chat channel source authority | Discord `metadata_only` update assertion | Chat 1/3 (also 2/3) | Open |
| D. Generic server shards | Not yet classified | Server 2, 9, 10, 11 | Open |
| E. UI unit test | One button-query assertion | Workspaces-a 2/2 | Open |
| F. Playwright e2e | `tests/e2e/fixtures/managed-connection-review-cases.ts:12`, `signoff-policy.spec.ts:523` and `:579` | 6 shards | Open |
| H. Product browser, agent chat | Unknown. A 110 MB failure artifact | 1 | Open |
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
