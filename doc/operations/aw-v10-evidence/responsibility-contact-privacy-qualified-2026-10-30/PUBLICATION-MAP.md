# Responsibility contacts authorization and UI privacy closure

The staged closure aligns the Human-only responsibility-contact endpoints with the Company Settings contact roster and mutation flow. Named Human requests bind both GET and PATCH to the expected user and session. The existing local-trusted Board path uses the `local-board` expected user and omits a session header when there is no session. The routes retain current Board owner/admin authorization and deny API-key actors, stale user/session headers, and unauthorized Board roles.

The UI query is scoped by company, principal, session, authority epoch, and a ref-backed scope epoch. It uses no-store, abort and post-await checks. Contact roster and local draft state render only while the current source read is successful, idle and not invalidated. The write captures company, actor, session, authority/scope epochs and both contact values, then confirms the same current authority before invalidating the exact captured query. Contact labels remain accountability metadata and grant no permissions.

## Qualification

- Backend route cohort: 14 passed, 10 skipped from `backend-route-test.log`; server TSC passed with an identical route source hash. See `backend-source-pins.json` and `backend-SHA256SUMS`.
- UI Company Settings/API cohort: 23 passed from `ui-tests.log`; UI TSC passed. See `ui-qualification-source-pins.json`.
- Post-publication snapshot copied and verified 1,185 current source files; Oxc parsed all five published UI/API files. See `post-publication-source-pins.json` and the publication logs in the candidate qualification directory.
- UI and backend cohorts qualified separately against their exact source receipts; no database schema or migration changed.

The exact seven-file commit set is `STAGE-LIST.txt`. `combined-owned.sha256` pins all seven staged source files. The backend reconstruction pins and UI qualification pins are also included; `SHA256SUMS` protects the portable evidence bundle.

No commit or deployment has been made.
