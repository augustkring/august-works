# Workspace typecheck r6, 2026-10-26

Fresh source snapshot copied and verified 319 files; Vite/Oxc syntax preflight passed 285/285. Generated help check, Runner emit/surfaces/provider entrypoints, and Shared TS7 single-threaded typecheck passed. Server and CLI TS7 single-threaded typechecks failed on the same three errors in Scope-owned `native-direct-input.ts`: line 968 unknown-to-string assignment, line 978 PgColumn/never overload, and line 1074 possibly undefined conversation binding. The previous `control.ts receipt.data` errors were absent in this snapshot.

Runtime: pinned pnpm 9.15.4, Node 24.19.0, TypeScript 7.0.2. Commands ran from the qualification tree under the shared host lock, with `--singleThreaded` and no install. Source pins and exact logs/exits are preserved here; this is a failure record, not a green whole-workspace claim.
