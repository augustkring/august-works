# Current Human fixture repairs: heartbeat, routine secrets, Slack lifecycle

This evidence records focused fixture-only changes for three CI failures. The production guards remain unchanged.

- `heartbeat-runtime-skills.test.ts` now seeds the company's configured `responsible-user` as a current company Human before dispatching heartbeat runs.
- `qa-routine-secrets-e2e.test.ts` now creates routines as a seeded, authenticated current Human rather than passing an empty actor. Teardown removes that fixture's permission grants and memberships before deleting companies.
- `slack-conversation-lifecycle.test.ts` now seeds the `local-board` owner membership and grants for the fixture company so existing organization access checks see a current member.

## Verification

The three complete test files ran from `/workspace/v10-dep-qualification/server` after the shared lock and current-source snapshot. Vitest 4.1.11 reported 3 files passed and 48 tests passed (exit 0). The pinned Oxc snapshot syntax check reported 889 files passed (exit 0). Source snapshot head: `c014f3bb74cf1896bf03401b1c785e966c3a41cc`; qualification base: `886014cae5a7d6ed5a9ab99d62613ec7646308cb`.

The exact source pin manifest is `source-pins.json`. Its reconstruction patch is `source.patch.gz`; the complete test output is `test.log.gz`. Snapshot and syntax logs and exit codes are preserved alongside them. The test output scan found zero bearer-token and zero `pcgw_` pattern matches.
