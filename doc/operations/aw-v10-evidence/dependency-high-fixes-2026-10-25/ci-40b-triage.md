# CI40b failure triage

Run: `40245236328` (PR42, 2026-10-25). This triage was read-only; no dependency installation, build, test, commit, or push was performed.

## Retrieved job evidence

- `121325307333` — Typecheck + Release Registry: dependency install completed successfully. The final `typecheck:build-gaps` step failed on four CLI test fixture type errors. `cli/src/__tests__/company-delete.test.ts` passes an optional `locale` where `Company.locale` is required. `cli/src/__tests__/company.test.ts` has three `CompanyPortabilityCompanyManifestEntry` fixtures missing required `locale` and `timezone` fields. These are fixture/type-contract failures, not package-resolution failures.
- `121325307507` — General tests, server (1/12): dependency install completed successfully. Vitest reported 6 failing files and 16 failing tests (67 files and 3,960 tests passed). Failures span Learning private-source authority, V7 Foundation task/source identity, V9 routine erasure, workspace-runtime teardown/branch checks, workflow direct-agent cleanup, and a stale test database schema missing `companies.locale`. This is not a shared dependency-install failure.
- `121325307540` and `121325307531` — General tests, workspaces-a (1/2 and 2/2): step summaries show dependency installation succeeded and only `Run grouped general test suites` failed. Full log downloads repeatedly returned GitHub connector `Transport closed`, so the individual test failures could not be inspected in this session.

## Run-level scope

The run job summary lists 22 failed jobs. In addition to the three jobs above, failures include Paperclip Runner verification, Help release-evidence validation, several e2e shards, and serialized server shards. The job summary establishes that these are test/verification-step failures; it does not establish that the dependency upgrades caused them. Source and test failures remain assigned to their owning workstreams.

The workspace log retrieval limitation was confirmed by repeated calls to the GitHub Actions job-log connector for jobs `121325307540` and `121325307531`; unauthenticated direct GitHub API access is blocked in this environment. No attempt was made to bypass the connector or obtain credentials.
