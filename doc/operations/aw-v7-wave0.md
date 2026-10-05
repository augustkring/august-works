# August Works V7 Wave 0: configuration admission and evidence

Date: 2026-10-05. Branch: `codex/aw-v7-wave0`. Baseline: post-V6 master `137e6ab386d6e579e9057d2c44b583a7167dc29f`.

## Delivered scope

Twenty reserved V7 flags default off in the shared validator, API normalization and Cloud/self-hosted catalog. Dependencies are checked against effective V4/V5/V6 flags, including their transitive gates and managed overlays. Startup reads validate every deployment profile; invalid persisted/effective combinations fail admission. Experimental PATCH returns HTTP 400 with `V7_FEATURE_DEPENDENCY_INVALID` and `{feature, required}` issues before committing an invalid combination.

The experimental write locks the singleton in a transaction and rereads current state before merge/validation. The admin route commits settings and all company audit rows in the same transaction; live-event publication runs after commit and is best effort. Caller-owned transactions are supported. This closes both lost-patch races and dependent-enable/prerequisite-disable races. A rollback patch can repair an invalid stored combination without first obtaining a valid view. A conflicting managed overlay must be repaired at its source.

This slice adds no domain SQL migration, provider dependency, product UI, entitlement change or execution behavior. Flags reserve rollout contracts; setting a flag does not implement, qualify or authorize its feature. See [the migration map](../plans/2026-10-05-aw-v7-migration-map.md) and [14 proposed ADRs](../adr/V7-ARCHITECTURE-DECISIONS.md).

## Baseline acceptance status

V5 and V6 implementation merges are present on the reviewed master. Their local evidence lives in [V5 acceptance](../plans/2026-10-04-v5-acceptance-evidence.md) and [V6 operations](aw-v6-foundation.md). Merge status is not live provider qualification. Outstanding hosted-runtime, email, billing, restore and other integration evidence must be reviewed for each affected V7 wave; no acceptance or launch claim is inherited merely from a merged PR.

## Local verification

| Check | Result and limits |
| --- | --- |
| All shared Vitest suites | PASS: 90 files, 840 tests; includes default-off/partial-patch, catalog, V5/V6 and V7 dependency contracts. |
| Instance settings + routes + V7 migrated PostgreSQL | PASS: 6 files, 127 tests. Five V7 database tests cover admission, effective managed settings, concurrent conflicting/independent patches and caller-owned rollback. Route tests verify transactional audit and no success publication on audit failure. |
| Shared build / plugin build dependencies | PASS via `node scripts/ensure-plugin-build-deps.mjs`. |
| Server TypeScript | PASS via direct `tsc --noEmit -p server/tsconfig.json` after required TypeScript dependency builds. |
| UI TypeScript | PASS via direct `tsc --noEmit -p ui/tsconfig.json`. |
| Module boundary script | PASS. |
| V4 security-eval coverage map | PASS: 18 gates / 7 domains / 27 suites / 17 metrics. This checks coverage metadata; it is not execution of all security evals. |
| Token gate script | PASS: 1,130 files, all four gates clean; no UI changes in this slice. |
| Repository-wide and normal server typecheck / native runner build | BLOCKED: `prepare:runner-vendor` requires `cargo`, absent in this environment. TypeScript checks do not substitute for the native build. |
| Whole-monorepo tests and full production build | NOT RUN: native runner prerequisites are unavailable; this slice received the relevant shared, settings, route and PostgreSQL checks above. This ledger does not mark the change release-ready. |

Commands used the repository-pinned pnpm 9.15.4 when invoking pnpm. A first nested pnpm invocation used the environment's pnpm 11 and attempted dependency housekeeping; its lock/workspace changes were removed. No dependency or lockfile change belongs to this implementation. Subsequent nested invocations use a local wrapper outside the repository to select pnpm 9.15.4.

## Provider source revalidation

Observed public metadata at 2026-10-05 08:37 UTC. [Machine-readable observations and source hashes](aw-v7-evidence/upstream-revalidation-2026-10-05.json) distinguish default-branch head from release tag. Neither is an adopted production pin. Exact tag commit, image digest, SBOM, notices, vulnerability/provenance review and AW acceptance evidence remain required before adoption.

| Candidate | Observed release | License evidence | Decision |
| --- | --- | --- | --- |
| [OpenShell](https://github.com/NVIDIA/OpenShell/releases/tag/v0.1.2) | v0.1.2, 2026-09-28 | Release LICENSE: Apache-2.0; release security-policy document read for boundary design. | Candidate for Wave 12 only after Wave 11 seam and qualification. |
| [Hindsight](https://github.com/vectorize-io/hindsight/releases/tag/v0.10.2) | v0.10.2, 2026-09-29 | Release LICENSE: MIT. | Wave 4 spike candidate, governed-only mode; no deployment. |
| [NemoClaw](https://github.com/NVIDIA/NemoClaw) | Latest-release endpoint returned 404 | GitHub repository metadata says Apache-2.0; not a release audit. | Reference; no production adoption decision. |
| [ToolHive](https://github.com/stacklok/toolhive/releases/tag/v0.51.4) | v0.51.4, 2026-09-27 | GitHub metadata says Apache-2.0; component/release notices remain open. | Optional infrastructure reference; existing runtime authority remains AW-owned. |
| [Langfuse](https://github.com/langfuse/langfuse/releases/tag/v4.50.0) | v4.50.0, 2026-10-02 | Release LICENSE reserves `ee/`, `web/src/ee/`, `worker/src/ee/` under `ee/LICENSE`; other eligible code MIT and dependencies under original licenses. | Mixed license. No blanket MIT approval or enterprise adoption; telemetry purpose/retention must be qualified. |
| [Foreman](https://github.com/thruwire/foreman/releases/tag/v0.4.1) | v0.4.1, 2026-09-27 | GitHub metadata says MIT; release/component audit remains open. | Design reference, no dependency added. |

License text alone does not prove operational maturity, tenant isolation, deletion, residency, security boundaries or acceptable cost. Third-party notices are updated when an actual dependency is adopted, not for an uninstalled reference.

## Regulatory source revalidation

[European Commission AI Act Service Desk, Article 113](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-113) was retrieved on 2026-10-05. It presents the consolidated text based on 27 July 2026, including amendments, with general application 2 August 2026 and specified high-risk deadlines 2 December 2027 for Article 6(2)/Annex III and 2 August 2028 for Article 6(1)/Annex I. It also lists earlier and specific derogations. Do not reduce those provisions to one product-wide date.

The direct [EUR-Lex consolidated-text request](https://eur-lex.europa.eu/eli/reg/2024/1689/2026-07-27/eng) returned HTTP 202 with no usable text. Consequently the current source-law validation gate remains open: reconcile the enacted consolidated text, exact provisions, operator roles and intended use before publishing applicability or compliance claims. No legal dates are encoded as application policy by this slice.

[Digitaliseringsstyrelsen's NIS 2 FAQ](https://digst.dk/tilsyn/nis-2/faq-om-nis-2/) was retrieved and its cloud/managed-service/jurisdiction guidance reviewed. It states that using third-party cloud does not automatically make a service a cloudcomputing service, and explains a facts-based assessment. AW's actual service, entity size, role and Danish/EU jurisdiction must be assessed; neither universal applicability nor universal exclusion is established here.

## Remaining Wave 0 gates

| Gate | Owner role | Evidence required before closure |
| --- | --- | --- |
| V5/V6 acceptance relevant to each new feature | Platform/runtime/billing domain owner | Exact revision and representative integration evidence, not merge status alone. |
| Provider adoption | Runtime or Memory domain owner | Immutable candidate pin/digest, license/notice scope, dependency and vulnerability evidence, boundary/deletion/isolation tests, operational and replacement cost. |
| Source law and applicability | Accountable governance reviewer | Current enacted text, clause-level dates, company/use-case facts, operator roles and revalidation triggers. |
| Full build/monorepo validation | Engineering owner | Rust-capable environment and required repository-wide checks on the final change. |
| Detailed schema/API contracts | Each owning-wave domain owner | Final master reconciliation, tenant constraints, CAS/idempotency, lifecycle and rollout/rollback evidence. |

The Wave 0 configuration foundation is implemented. Wave 0 as a whole remains open on the gates above. Wave 1 implementation can proceed behind default-off flags; material enablement requires the corresponding acceptance and predecessor evidence.
