# Production dependency high advisory fix evidence

Pinned pnpm 9.15.4 audit started at 8 high / 0 critical advisories and now reports 0 high / 0 critical. Raw JSON reports are archived in `audit-before.json`, `audit-lockfile.json`, and `audit-installed.json`; their counts and the installed version receipts are in `source-pins.json`.

The frozen install and targeted checks ran in `/workspace/v10-dep-qualification`, a detached worktree at the same source commit as the main workspace. The seven manifests and lockfile listed in `manifests-and-lock.sha256` were copied from the dirty main workspace after dependency edits and match the main workspace files at archive time. Other uncommitted source edits in the main workspace were not copied into the qualification worktree. The original `/workspace/blentera-v10/node_modules` was not changed.

`receipts.json` records the sanitized command-result logs. The frozen install completed with exit code 0. Cursor SDK import, adapter typecheck, 20 Cursor Cloud tests, and 6 Teams credential tests passed. The install used `--ignore-scripts`; PNPM reported expected missing generated plugin SDK bin targets in this clean detached worktree, which are unrelated to the dependency checks.

The lock diff changes only the affected workspace importers and security dependency closures. Vite 8.3.5 also updates its Rolldown/OXC packages and dependent Vite peer snapshots; no unrelated direct dependency importer changes were found.

## 2026-10-26 axe and route-check follow-up

axe-lock-source-pins.json and focused-route-source-pins.json retain the exact qualification inputs. Both identify source head 995880c247e3f57b5dcbb5403a49d4f0998ac18a and qualification base 886014cae5a7d6ed5a9ab99d62613ec7646308cb; copied-file SHA-256 entries identify the dirty source files synchronized into the qualification workspace. The focused route run used the latter snapshot, which includes the exact current package manifest, lockfile, and four test files. receipts.json's later archive sourceCommit (76d7cc8f...) is the checkout identity when these records were archived, not the tested source identity.

The root axe-core@4.13.0 importer was validated with pinned pnpm 9.15.4 using install --lockfile-only --frozen-lockfile --offline --ignore-scripts in a disposable manifest copy. It exited 0 and left the copied lock hash unchanged at 6be0b922726cde633bd39fd4513013fce9bad5bc0da79d77ffc210afb5818d7f.

The focused current route/OpenAPI check passed 4 files and 47 tests. The module-resolution receipt records 424 main-workspace links, all resolving to the qualified dependency tree or current main workspace packages; the retained main .pnpm tree was left intact. This environment repair did update symlinks in the main workspace after the earlier dependency-only qualification; it did not install or copy package payloads or delete the retained store. The exact resolved versions and paths are in dependency-module-recovery.log.gz.
