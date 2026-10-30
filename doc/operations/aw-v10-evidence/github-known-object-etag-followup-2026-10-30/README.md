# GitHub object ETag validator follow-up (2026-10-30)

A stored ETag is sent only when the known GitHub object also has a valid `updated_at` source version. A `304 Not Modified` is accepted only if that safe conditional validator was actually sent. Legacy ETag rows without a valid version therefore make a full canonical GET, allowing a 200 response to repair the row; unsolicited 304 responses are rejected.

Qualification used a fresh source snapshot in `/workspace/v10-dep-qualification`, Vitest 4.1.11, the Vite/Oxc syntax checker, and the shared PostgreSQL lock. `external-objects-service.test.ts` passed 33/33, including valid 304, legacy ETag plus missing/invalid version followed by full 200 repair, and rejected 304 after an unsafe validator was omitted. Oxc parsed 982 JS/TS files. No live provider calls or full server TypeScript check were run.

- Base and source head: `c78a7699e88667c53b11de9dad715fa8ef5bee51`.
- Source-pins SHA-256: `d5bd41bfb45aad26fef4f210d03b20961db59d829cc1ca5cc15412ddcdc4cee6`.
- Runner: `/workspace/v10-preparation/run-github-known-object-etag-followup-r1-20261030.sh`.
- Dependency boundary: `/workspace/v10-dep-qualification`; no MAIN dependency command.

The exact two-file follow-up stage boundary is in `stage-list.txt`; source hashes are in `source-stage-candidate-hashes.json` and `source-stage-candidate.sha256` (verify from repository root with `sha256sum -c doc/operations/aw-v10-evidence/github-known-object-etag-followup-2026-10-30/source-stage-candidate.sha256`). The tar preserves the raw runner, pins, source patch, untracked files, syntax/test logs, and the exact two-file source patch/copies.
