# V9 experience coverage

The [coverage manifest](coverage.json) links stable screen IDs to exact sections
of the unchanged V3 brief, including all ONB/HIRE/CUSTOM screens. It distinguishes
source-defined policy from delivered and verified behavior. Source paragraph
hashes prevent accidental specification drift. The full runtime schema lives
in `packages/shared/src/experience.ts`; required fields follow §76.2.

Run `pnpm check:aw-v9-coverage` to check source inventory and traceability.
`pnpm check:aw-v9-coverage -- --release` additionally requires resolved contracts,
component paths and passed functional/accessibility/security/privacy/usability
evidence for each surface tied to an exact artifact. A pending surface never
passes release just because the brief describes it. Evidence entries have
`kind`, `status`, `artifactSha` and repository `path` fields.

See [architecture decisions](../../adr/V9-ARCHITECTURE-DECISIONS.md),
[implementation ledger](../../plans/2026-10-09-aw-v9-build.md) and
[source readiness](../../../evals/aw-v9/readiness.json). Operator activation and
hosted qualification remain separate from source coverage.
