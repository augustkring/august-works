# CLAUDE.md

@AGENTS.md

The rules above apply in full. This file adds what Claude Code needs to work
efficiently in this repository.

## Current work

- Product: Blentera, a fork of Paperclip; package names still use `@paperclipai`.
- Requirements: `doc/reference/blentera-v10/Blentera_Master_Build_Brief_V10_FINAL_v4.0_2026-10-18.md`.
- Integration branch: `codex/blentera-v10` (draft PR #42). Send small PRs into it.
- Verification plan and status: `doc/plans/2026-11-12-claude-v10-verification.md`.
- Requirement register (169 rows): `doc/operations/aw-v10-evidence/recovery-2026-10-22/requirement-reconciliation.json`.
- Priority closeout: `doc/plans/2026-10-28-v10-current-reconciliation.md`.

## Large reference files: never read whole

| File | Size | How to use it |
|---|---|---|
| V10 brief | about 150k tokens | Read `doc/reference/blentera-v10/index.md`, then only the line range you need |
| 39 playbooks | 20k-75k tokens each | Use a `pb-*` skill, or `doc/reference/aw-v9/playbooks/index/`, then read line ranges |
| Requirement register | 1 MB of JSON | Query it with `jq`, for example `jq '.items[] \| select(.id=="V10-005")'` |
| `doc/operations/aw-v10-evidence/` | 684 MB | Open only the README of the folder you need |

After changing a playbook or the brief, run `node scripts/build-reference-index.mjs`.

## Playbook routing

| Area | Skill |
|---|---|
| Security, privacy, tenant isolation, erasure | `pb-security-privacy` |
| Schema, migrations, APIs, jobs, idempotency | `pb-data-api-backend` |
| Agents, Native runner, tools, MCP, models, spend | `pb-agentic-ai` |
| Tests, CI, reliability, delivery | `pb-verification-reliability` |
| Screens, UX, accessibility, copy, EN/DA | `pb-ui-ux-writing` (with `design-guide`) |

Playbooks for ads, blockchain, embedded, mobile and brand do not apply to this work.

## Testing

- Run the smallest relevant check first, for example
  `pnpm exec vitest run <file> --project <project>` or one package's typecheck.
- Server tests start embedded Postgres per file and run one worker at a time.
- The full suite takes about 2 hours serially. Let CI run it; do not run it locally for every change.
- UI changes: `pnpm check:token-gates` and `pnpm check:customer-brand`.
- Never skip, disable or quarantine a test to get green. Record failures as failures.

### Running tests in a Claude Code cloud container

Checked on 2026-11-12. Three things differ from CI:

1. Use Node 24. The repo needs `>=24.11`, and the container defaults to Node 22:
   `export PATH=/opt/node24/bin:$PATH`.
2. Embedded Postgres refuses to start as root, and these tests then report as **skipped**,
   not failed. Run tests as the `ubuntu` user after `chown -R ubuntu:ubuntu` on the checkout
   (root git then needs `git config --global --add safe.directory <repo>`):
   `runuser -u ubuntu -- env PATH=/opt/node24/bin:$PATH HOME=/tmp/ubuntu-home pnpm exec vitest run <file>`
   from the package directory. A run that reports only skipped tests has not verified anything.
3. Build the workspace packages that a test imports from `dist`, for example
   `pnpm --filter "@paperclipai/plugin-sdk..." build`.

## Before you push

The `coverage` workflow pins hashes of many source and test files. After you change files,
run these and commit any regenerated output:

- `node scripts/generate-v10-safe-change-graph.mjs` (then `node scripts/check-v10-safe-change-graph.mjs`)
- `node scripts/platform-skill-migration-register.mjs` (add `--write` if it reports stale, for example after an `AGENTS.md` change)
- `node scripts/build-reference-index.mjs --check`
- `pnpm -s run check:v10-169-migration-phases`. It has no write mode: if it reports `source pin changed: <path>`, set that path's `sha256` in `doc/operations/aw-v10-evidence/v10-169-migration-phases-current-2026-10-30/phase-matrix.json` to the file's current `sha256sum`.

## Evidence

Do not create new folders under `doc/operations/aw-v10-evidence/`. Record verification
results in the dated verification ledger or a short dated summary under `doc/operations/`.
Leave the bulky output in CI artifacts.

## Model and effort

| Work | Model | Effort |
|---|---|---|
| Planning, root-cause debugging | Opus | high |
| Authority, privacy and spend audits | Opus | xhigh |
| Fixes with a clear repro, register checks, UI token fixes, tests | Sonnet | medium |
| Search, log summaries, Explore subagents | Haiku or Sonnet | low |
| Problems Opus has failed twice | Fable | high |

Keep each session on one area. Subagents return conclusions, not file dumps.
