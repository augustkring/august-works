# V8 source acceptance crosswalk

Reconciled on 2026-10-08 against build brief V8 V2 section 57. This is a review
crosswalk, not a passed release claim manifest. Native-owner checkpoint 53 is
committed on the requested branch. `evals/aw-v8/readiness.json` retains R0,
`sourceComplete: false`, no release identity, and no accepted risk owner.

The remote master base remains `d550aa7ea5ad38b5209d79135cabaa227ab3f902`.
Current repository-wide checks identify their exact source commit separately.
Historical local receipts cannot qualify a different source, configuration,
caller, hosted environment or restored filesystem.

| §57 | Required behavior | Existing implementation / inspectable verification |
| --- | --- | --- |
| 1 | Current master base | Branch base above; remote master checked on 2026-10-08 |
| 2 | V4–V7 regressions/security remain green | Current `pnpm test:run` verification; previous local receipts do not clear this gate |
| 3 | No stale V8 merge | New requested branch and incremental Git history from the declared master base |
| 4 | Governed versioned metrics and lineage | `server/src/services/business-metrics/service.ts`; `server/src/__tests__/business-metrics.integration.test.ts` |
| 5 | Known-answer metric evaluation | `server/src/__tests__/business-metric-engine.test.ts` |
| 6 | Idempotent source-linked events | `server/src/routes/business-events.ts`; `server/src/__tests__/business-events.integration.test.ts` |
| 7 | Refuse bad process data | `server/src/__tests__/process-data-readiness-engine.test.ts`; `server/src/__tests__/process-analysis.integration.test.ts` |
| 8 | Non-causal evidence-linked findings | `server/src/services/process-analysis.ts`; `ui/src/components/ProcessFindings.test.tsx` |
| 9 | Extend original Decisions | `server/src/services/decision-intelligence.ts`; `server/src/__tests__/decision-intelligence.integration.test.ts` |
| 10 | End-to-end outcome review | `server/src/__tests__/decision-outcome-reviews.integration.test.ts`; `tests/e2e/decision-review-learning.spec.ts` |
| 11 | Baseline/backtest before provider | `server/src/services/business-forecasting/service.ts`; `server/src/__tests__/business-forecasting.integration.test.ts` |
| 12 | Conditional scenarios do not commit | `server/src/routes/business-scenarios.ts`; `ui/src/pages/BusinessScenarios.test.tsx` |
| 13 | Governed exposure-safe experiments | `server/src/services/business-experiments/recording.ts`; `server/src/__tests__/business-experiment-recording.integration.test.ts` |
| 14 | Causal non-identification/abstention | `server/src/services/causal-claims/kernel.ts`; `server/src/__tests__/causal-claims.integration.test.ts` |
| 15 | Deterministic constraints; planning is proposal-only | `server/src/__tests__/adaptive-planning-kernel.test.ts`; `server/src/__tests__/adaptive-planning-cross-project.integration.test.ts` |
| 16 | Structured material Review evidence | `server/src/services/management-reviews/capture.ts`; `server/src/__tests__/management-reviews.integration.test.ts` |
| 17 | Derived-data privacy/export/deletion/retention | `doc/operations/aw-v8-source-and-data-register.md`; `server/src/__tests__/analytical-context-privacy.integration.test.ts`; local archive/restore, orphan and governed backfill metadata receipts 49–52 |
| 18 | Cross-company authorization | Original native route/Source admission and the domain integration suites above; current whole regression gate remains separate |
| 19 | Reject employment/performance scoring | Strict typed dimensions/protocols; `packages/shared/src/business-metrics.test.ts`; `packages/shared/src/business-experiments.test.ts` |
| 20 | Optional versioned qualified providers | Locked StatsForecast/DoWhy profiles and owner checks; `doc/operations/aw-v8-optional-semantic-provider-decision.md`; customer semantic adapter is conditional on an existing supplied source |
| 21 | Python has no ambient database/secret authority | `server/src/services/native-runtime/numerical-worker.ts`; actual isolated worker regression receipts; hosted image/profile qualification remains separate |
| 22 | Typed V8 route contracts | Complete exact mounted-route OpenAPI coverage in `server/src/__tests__/openapi-routes.test.ts`; shared domain validators and existing `server/src/routes/business-metrics.ts`, `server/src/routes/process-analysis.ts`, `server/src/routes/decision-intelligence.ts`, `server/src/routes/business-experiments.ts`, `server/src/routes/management-reviews.ts` |
| 23 | UI account/company isolation | `ui/src/pages/BusinessMetrics.test.tsx`; `ui/src/components/DecisionContextPanel.test.tsx`; corresponding domain UI tests |
| 24 | Accessibility and actual browser flows | Native `tests/e2e/` and material `tests/storybook-visual/` receipts retained in the plan; no authenticated hosted Human trial is inferred |
| 25 | Analytics performance/cost envelopes | Original 30-second/8-second SQL and bounded payload/population owners; local 10,000 metric Sources, 4,000 Forecast Tasks and 68,000 experiment outcomes; hosted p95/COGS remain open |
| 26 | Source versus live qualification | `packages/shared/src/v8-assurance.ts`; `evals/aw-v8/readiness.json` |
| 27 | Visible applicable predecessor blockers | H6-01–18/H7-01–03 remain open in readiness; source tests cannot clear hosted controls |
| 28 | Mechanical requirement/change/test/evidence traceability | This crosswalk → native-owner plan checkpoints → Git commits and exact receipt source/test hashes; PR/CI/Greptile review gates remain open |

Local implementation receipts are indexed with checked SHA-256 values in
`evals/aw-v8/readiness.json`. The chronological change ledger is
`doc/plans/2026-10-06-aw-v8-build.md`. Source ownership and data surfaces remain
in the original data register, rather than creating another authority store.

Remaining source acceptance includes current full checks and complete claim/Source
reconciliation. The local historical cache and database restore fixtures do not
establish provider/workspace/home/remote-storage erasure, every historical
publisher combination or a complete privacy graph. Those limits remain explicit.

Hosted sections 58 and H0–H12 require the actual organization-owned UpCloud
environment, private PostgreSQL/S3/TLS/OpenShell configuration, current credential
and pre-spend qualification, legal/provider/account facts, protected pilot,
observed calibration/COGS, independent reviews and named risk acceptance.
No such identities or credentials are attached to this execution environment.
The environment/source question remains pending. No cloud resources, customer
messages, live intervention, release publication or deployment is performed.
