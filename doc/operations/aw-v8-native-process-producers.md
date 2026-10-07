# Native activity producers for process evidence

New Task creation activity records the returned Task's project ID together with
the existing native status receipt. The main Task PATCH and transactional review
PATCH record the returned project relationship, the committed status when a
status was requested or the row-lock-backed receipt reports a state change, and
the receipt's previous status when available. Requested status alone cannot
override a different returned committed state. Pure metadata edits add no
fabricated state transition. These fields contain no new actor identity or body.

Project creation activity records its returned native status. Project PATCH
records status only for a status mutation, using the returned Project rather
than rereading a later current state. Environment-only edits remain status-free;
existing audit behavior continues to record environment keys without values.

These are prospective producer changes, not historical enrichment. The existing
`aw-activity-v2` projector already admits these typed status/previous-status and
recorded project fields. Its version and projection algorithm remain unchanged.
No retained source row is rewritten and no missing old state or relationship is
inferred from current assignments. Old data can remain inconclusive under the
intrinsic lifecycle requirements. Coverage is still the current retained native
activity snapshot, not certification of all producer paths or transport arrival.

Native migrated PostgreSQL route tests create a Task, complete it, edit metadata,
inspect emitted facts and verify that later reassignment cannot rewrite its
recorded creation relationship. Project route tests exercise the actual producer
and projector across creation/completion and preserve the environment-only audit
contract. The existing Task comment/reopen suite verifies compatibility with
human and agent review behavior. The combined selection passes 111 tests.

The preceding explicit-model/finding slices pass 31 server/PostgreSQL/OpenAPI
tests, 11 UI tests, 24 Chromium light/dark/mobile/desktop keyboard/WCAG scenarios,
generated migration-snapshot checks, token gates and TypeScript. The server
TypeScript retry passed with compiler concurrency reduced after a host memory
limit interrupted the first attempt. Mobile comparison selectors were visually
inspected after the layout correction. These results qualify the local source
slices only; official visual baselines, full V8 completion and hosted rollout
remain open.
