# V10-059 customer release notes

Implemented through the existing operator-owned announcement manifest/feed, with typed customer changes, affected audience, required action, documentation, rollback and known limitations. Help renders English/Danish labels and an explicit locale fallback. Publication coverage is a bounded window; missing configuration, fetch failure and incomplete notes remain explicit. Company/profile-scoped notices are excluded, while canonical mandatory actions remain separate. No release was externally published.

Actual source-pinned checks:

- Feed: 31/31 passed, including historical expiry, preferred locale, private/profile/future/version exclusion and malformed release contracts.
- PostgreSQL route: 1 selected passed, 12 skipped; authenticated no-store history remains available after optional news dismissal, invalid locale and anonymous requests denied.
- UI: 12/12 passed across customer Help and release notes, including locale fallback, current activity scope and configuration state.
- Existing OpenAPI generation: 1 selected passed, 27 skipped. API identity now uses the canonical Blentera product identity.

Source snapshots and logs are separate receipts, not a combined whole-workspace or full-V10 acceptance. Help metadata/local links, generated Help catalog, brand and token gates passed in the current working tree. Final unchanged-head full checks and current release qualification remain required.
