# Platform Skill runtime conformance

`runtime-conformance.json` is the source-owned contract for the V10-140 / V10-143 cross-runtime comparison. It reuses adapter dispatch and admission tests, records exact test-file/config hashes, pins the immutable release under test, and leaves external installed-runtime qualification open. It is separate from `cases.json`: prompt evaluation does not prove adapter delivery, collision handling, or run-boundary behavior.

Run one or more source suites with:

```sh
node scripts/run-platform-skill-runtime-conformance.mjs --profile openclaw
node scripts/run-platform-skill-runtime-conformance.mjs --profile hermes-local
node scripts/run-platform-skill-runtime-conformance.mjs --profile blentera-managed-native
```

The runner executes only the named existing Vitest tests. It hashes the implementation sources alongside the tests/configs and uses deterministic adapter fixtures; it does not contact a live provider. Native's existing admission and company-Skill owner suites may need the repository's normal test database setup. `--dry-run` validates source/test pins and prints the proposed commands without executing tests or retaining a receipt. A run receipt retains the command, implementation/test/config hashes, release pins, source output and exit code under `doc/operations/aw-v10-evidence/platform-skill-runtime-conformance-YYYY-MM-DD/`.

The five common scenarios map to each source-implemented runtime. Native uses its exact immutable run admission, company-scoped runtime materialization, reserved-name owner, and old-run re-admission tests; OpenClaw uses deterministic Gateway dispatch fixtures with distinct provider agents and run-bound bridge admissions; Hermes uses its executor with a real temporary presence profile and a stubbed child-process boundary. Recovery is runtime-specific: Native leaves old run pins immutable, OpenClaw will not retry after remote-work begins, and Hermes resumes only with its current verified profile hash. The runner checks test-title anchors and hashes the exact sources before execution.

OpenClaw, Hermes, and A2A/custom remain unqualified. Source-suite success alone is not a GA determination. Qualification additionally needs the exact installed runtime/profile version, observed effective Skill digest and delivery boundary, complete common routing/process/security/recovery results, and Human platform-owner review. A2A/custom has no common delivery driver or test suite yet; its qualification prerequisites are listed in the contract.
