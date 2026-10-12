# Wider CI regression repairs

The preceding published PR head failed notification delivery, workspace UI,
migration replay and mounted OpenAPI coverage checks. The policy/shard mismatch
was fixed separately and passed on GitHub.

Notification fixtures now declare their messages due explicitly. This avoids a
race between PostgreSQL microsecond defaults and JavaScript millisecond clocks;
production scheduling and delivery assertions remain unchanged. Hire tests now
expect the actual unprepared lifecycle and forbid publication. The support
dialog focus assertion waits for its actual restoration without changing the
expected target or timeout.

Migration journal repair skips an already-existing CREATE INDEX IF NOT EXISTS
before issuing redundant DDL. PostgreSQL otherwise refuses that DDL after an
idempotent backfill queues deferred trigger events. The original transaction,
backfills, triggers, constraints, journal hashes and missing-index creation are
retained. No migration file was rewritten or database guard disabled.

OpenAPI now covers current publication, setup, activation connection consent,
image transport, retention, memory maintenance, creation receipts and experience
measures. It records actual explicit consent, operator scope, multipart request
headers and processed-image response types. Publication remains blocked when its
native prerequisites are unmet; its qualified response is now documented.

Source `34a27131cd9d7675fe9c85a6b2d3c25303d28834`, SHA-256
`ef08f9a2814816cb4b4cdbe4bfc42082d4338e0c012395035848156dfd1177dd`,
passed 30 actual PostgreSQL cases in two files, 20 OpenAPI cases, 20 affected UI
cases, token checks, shared/DB builds and server/UI types. Source identity was
unchanged through Native and type qualification. Current GitHub CI, complete
integrated checks and the remaining full V9 implementation remain open.
