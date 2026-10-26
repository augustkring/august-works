# Shared safe error logging qualification

The focused logger and HTTP redaction run passed: 66 tests, 0 failures. The source snapshot was captured under the shared PostgreSQL flock in `/workspace/v10-dep-qualification`.

Coverage verifies that production Pino configuration applies the same safe projection to `err` and `error`, nested Drizzle-style causes do not emit message/query/params/stack path text, HTTP error serialization remains safe after Pino HTTP serializer wrapping, and bounded operational fields (`type`, HTTP status, SQLSTATE, numeric line/column) remain available.

Command, run from `/workspace/v10-dep-qualification/server` after sourcing `/workspace/v10-preparation/env.sh`, under `/workspace/v10-preparation/v10-pg-tests.lock`:

```sh
../node_modules/.bin/vitest run src/__tests__/logger-tz.test.ts src/__tests__/http-log-redaction.test.ts --maxWorkers=1
```

Pinned source head is `69b774c17497db81bbce15d08eec41531f9fbac2`, qualification base is `886014cae5a7d6ed5a9ab99d62613ec7646308cb`. The logger SHA-256 is `9569f32b3d871833092494a1a3055a0a1d61bd4ef2e74686206d91ab4ff462a9`; `logger-tz.test.ts` is `50d832778dfc0ba16c05e28d19809487b68d60e5642ce008af3f42065c577042`; `http-log-redaction.test.ts` is `f76db2a2186964a86123b3abe15ed0f81d06354d93d88fefe3221f168fe5131d`. Snapshot, compressed raw log and exit codes are included. Earlier failed iterations remain in `/workspace/v10-preparation` and are not qualification evidence.
