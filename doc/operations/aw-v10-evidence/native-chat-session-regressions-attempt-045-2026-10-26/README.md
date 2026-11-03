# Authenticated Native chat regressions attempt 045

Fresh pinned-source run of the metric-owner recovery and feature-flag lifecycle cases in `agent-chat-sessions.spec.ts`, using system Chromium. Exact selected titles were listed before launch, and the native execution failure-log privacy regression passed on the same snapshot. Assertions and timeouts were unchanged; `--max-failures=1` stopped after the first actual failure.

The metric owner was seeded as a separate current Human, so Metric creation, publish and query all succeeded. The case then failed when it tried to create a Context manifest for an already-settled chat run after the fact; current Context source access correctly denied that post-run capture. The feature-flag test did not run. This is partial evidence, not a suite pass. Numeric exit, pins, and traces are preserved here.
