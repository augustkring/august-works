# Committed source placement repair

Commit `814203d3b` moves the exact eleven-line audited manual-related Task proof into `assertNativeFrozenTaskSnapshotCurrent`, matching the tested working source. A prior partial index patch had placed it inside a synchronous Context-item callback, so GitHub could not parse the committed module. The staged corrected blob was parsed directly with Vitest Vite/Oxc before commit. No working source, Source guard, or test assertion was weakened.

The independent canonical snapshot `adapter-routes-current-r1-20261029` passes all 15 adapter route tests, zero skipped, exit 0 (21.04s), including actual registry import and route setup. Complete source pins, reconstruction patch, parser output and raw test output are archived losslessly. This scoped working-source receipt does not establish a whole-workspace or unchanged-HEAD pass; its exact capture is reconstructable from the pins.
