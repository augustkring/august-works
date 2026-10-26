# Legacy runtime bundle physical erasure guard

This focused PostgreSQL run validates two historical compatibility boundaries in the existing legacy runtime asset reconciliation owner:

- A content-addressed bundle remains on disk while either of two tenant Run profiles references it, and the reconciliation worker removes the bundle and manifest after both references are gone.
- The canonical Native runtime absence guard rejects an explicitly modeled pre-upgrade successful outbox receipt when the historical Run profile is already cleared but the bundle bytes remain.

The old successful receipt is a regression fixture representing persisted pre-fix state; it is not claimed as a success produced by the current worker. This test does not qualify Native provider execution or a Run Stop.

Run: `legacy-bundles-physical-guards-20261026-r1`  
Snapshot: `snapshot.exit=0`  
Syntax: `syntax.exit=0`  
Vitest: `2 passed, 1 skipped`, exit `0`  
Pinned OpenCode binary SHA-256: recorded in `legacy-bundles-physical-guards-r1-binary.sha256`.

The entire owner file was also rerun from a fresh snapshot: `legacy-bundles-full-file-20261026-r1`, `3 passed`, exit `0`. This includes the pre-existing active-run deferral, retained cross-tenant references, bounded orphan cleanup, partial publication handling, and symlink refusal checks. The full-file run does not qualify current Native provider execution or Stop evidence.
