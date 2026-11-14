# Native source policy and recovery checkpoint — 2026-11-11

The exact model output and its dispatch identify the execution Run. The input-source policy names the prompt sources and need not list that execution Run. This checkpoint corrects that distinction for progress, Human questions and repository results. New progress-comment snapshots add the separately registered dispatch Run to a copied comment policy. The original prompt policy remains unchanged. Current reader, Human, source, dispatch and provider-capture checks remain required.

The source also adds recovery/follow-up regressions, corrects two completion-contract fixtures, and adds bounded startup/failure diagnostics. The managed SDK matrix has 29 jobs. Those new SDK cases have not yet been qualified by execution.

R506 passed syntax transformation, all 46 routing checks and whitespace checks. R508 passed the full server TypeScript check (127.128 seconds) and Runner package TypeScript check (6.431 seconds), with exact source hashes and modification times unchanged. R509 passed 77 tests in three suites, including actual embedded PostgreSQL owner reconstruction, with normal cleanup and no remaining owned processes. These are software checks, not an actual OpenCode SDK, physical Host or external-provider qualification.

R507 remains failed: the safety harness stopped its compiler process group at the configured RSS cap. No OOM occurred. Source permissions were restored. R508 uses the repository's normal typecheck script and supplies the later successful checks.

The last recursive workspace typecheck and root build belong to the earlier R502 checkpoint. Full pnpm test:run, current-head CI, actual SDK/browser execution, complete V10 acceptance and merge readiness remain pending. MCP and channel candidates are separate and are not in this evidence. No requirement or migration-phase state is promoted by these source/check updates.

R510 later passed all 41 Task-context tests in 15.38 seconds. It corrects obsolete handoff text expectations and keeps the negative Ask/new-comment/unbound-confirmation checks effective. No PostgreSQL instance or SDK ran in this component suite. The R508 typechecks precede this test-only correction; their source manifests identify that boundary.
