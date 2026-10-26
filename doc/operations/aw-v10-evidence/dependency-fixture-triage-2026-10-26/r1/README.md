# Fixture and metric owner regression bundle

- Qualification source head: `7dc599641de2fd122f15fce54667a35d75bf6f25` (full source pins retained).
- Command: `vitest run --maxWorkers=1` for business metrics, Routine telemetry, typed Task origin, and V7 portability integration files.
- Result: 38 passed / 2 failed, across four files. Business metrics, Routine telemetry, and typed Task origins passed. The two V7 portability exporter assertions exceeded Vitest’s 30-second per-test default; its deliberate 101-row setup completed within the new 120-second setup budget. V7 test bodies then received explicit 120-second budgets and were validated green in the standalone full-file run archived under `../v7-full-r5/` (3/3).
- `business-metrics/service.ts` SHA-256: `f63bc919ed36664466a0df581ac0e5fb15408ec860f78ef86a42c4c7eb17ab1e`.
- Routine telemetry fixture SHA-256: `3d946c7fb929332239af9230e5a78f253ea7fbce833c92ae8afdfa7da505f24d`.
- Typed origin fixture SHA-256: `d4292be6e05e0fd928ed8b8b541b3fdab7ce3f7ba3d2739e150a8e9e73a1ed5f`.
- This result validates the metric population capture fix and canonical managed Routine fixtures. The final V7 fix is separately pinned and green in `../v7-full-r5/`.
