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
| 0 Setup | `CLAUDE.md`, reference indexes, `pb-*` router skills, test environment | Done (this PR) |
| 1 Triage | Cluster every failing CI job by root cause; rank by jobs fixed | Next |
| 2 Green CI | Fix one cluster per PR until `verify`, serialized, security and e2e pass | Open |
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

## Open owner decisions

- Email provider for signup and notifications.
- Keep Paddle or move to Stripe.
- Production domain, and when to run the rename plan (`2026-10-28-blentera-origin-and-repository-rename.md`).
- Named service owner, approved product and Trust Center claims, privacy policy, DPA and subprocessors.
- Whether the repository stays public. The brief and the playbooks are currently readable by anyone.
- Provider keys for live qualification in CI secrets: Anthropic, Slack, Teams, OpenClaw.
- Who runs the representative usability sessions that the beta gate requires.
