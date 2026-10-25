# Production dependency high advisory fix evidence

Pinned pnpm 9.15.4 audit started at 8 high / 0 critical advisories and now reports 0 high / 0 critical. Raw JSON reports are archived in `audit-before.json`, `audit-lockfile.json`, and `audit-installed.json`; their counts and the installed version receipts are in `source-pins.json`.

The frozen install and targeted checks ran in `/workspace/v10-dep-qualification`, a detached worktree at the same source commit as the main workspace. The seven manifests and lockfile listed in `manifests-and-lock.sha256` were copied from the dirty main workspace after dependency edits and match the main workspace files at archive time. Other uncommitted source edits in the main workspace were not copied into the qualification worktree. The original `/workspace/blentera-v10/node_modules` was not changed.

`receipts.json` records the sanitized command-result logs. The frozen install completed with exit code 0. Cursor SDK import, adapter typecheck, 20 Cursor Cloud tests, and 6 Teams credential tests passed. The install used `--ignore-scripts`; PNPM reported expected missing generated plugin SDK bin targets in this clean detached worktree, which are unrelated to the dependency checks.

The lock diff changes only the affected workspace importers and security dependency closures. Vite 8.3.5 also updates its Rolldown/OXC packages and dependent Vite peer snapshots; no unrelated direct dependency importer changes were found.
