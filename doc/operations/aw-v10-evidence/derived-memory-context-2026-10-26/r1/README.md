# Derived Memory Context latency check

The current derived-Memory Context regression passed after consolidating model lineage checks over the union of direct and observation-backed roots and removing the Context provider's duplicate list-then-get lineage walk. The lineage owner still checks each root's scope, purpose, accepted/current version, and retained-source ACL; Context manifest construction performs its canonical lineage recheck after provider reads.

The full `server/src/__tests__/v7-derived-memory.integration.test.ts` file passed **8/8 tests** from `/workspace/v10-dep-qualification/server`. The snapshot and syntax checks also exited 0. The target erasure case selected both expected manifest roots, then verified Run/Task payload erasure and rejection of late restored writes. Vitest duration was 32.14 seconds, starting at 19:11:40 UTC on 2026-10-26.

Source pins record base commit `886014cae5a7d6ed5a9ab99d62613ec7646308cb`, captured source head `94c3663541b14c6ee6e1cb19d748ac57ab54beab`, and 301 copied source files. Exact edited source hashes:

- `server/src/services/memory/derived-memory.ts`: `a9f9949b69c4e166b48a63780cc507c5a694f1c9e88e08e8d6bf37b6e90647d6`
- `server/src/services/memory/derived-context.ts`: `c0ab97dd3caf50a4f46db6d0332e4415512ad9791cef411f025024befee3fc85`

The source-pins JSON SHA-256 is `3104783027915268c734ba3465bea0dabe30da7c2f34e83c8df88c9994fab4e1`. The raw test-log SHA-256 is `9f209d4c5b6aeaaa0df0fbc43cad601d8342965f22004e1ae39a90c415d9a82d`.

The test was serialized with `/workspace/v10-preparation/v10-pg-tests.lock`; no install was run. `git diff --check` passed before the test.
