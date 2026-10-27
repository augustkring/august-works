# Universal Find notice projection validation (r1)

This run validates the bounded announcement/release/deprecation history projection in Universal Find against the shared announcement schema and existing feed owner. It does not publish notices, contact real providers, or claim full workspace typecheck/build completion.

The source-pins file records the qualification tree source used for the run. The Oxc syntax preflight passed for 368 TypeScript files. The focused pinned Vitest command ran `packages/shared/src/announcements.test.ts`, `server/src/__tests__/announcement-feed.test.ts`, `server/src/__tests__/company-search-rate-limit-routes.test.ts`, and `ui/src/pages/Search.test.tsx`: 4 files and 76 tests passed. Server TypeScript compilation was attempted but exited 137 with an empty log, so it is an OOM/unknown result rather than a diagnostic pass.

Raw logs and exit codes are retained unchanged from `/workspace/v10-preparation/universal-find-notices-20261027-r1-*`. `SHA256SUMS` covers the archived files including this note.
