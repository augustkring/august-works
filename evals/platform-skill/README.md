# Platform Skill Operating Knowledge audit

This source-integrity audit binds the immutable reserved `blentera-platform` release to the current Operation Manifest, the retained behavior corpus covering every enumerated §21B.28 software scenario family, the existing Skill Lifecycle evaluation/promotion owner, and the Native/OpenClaw/Hermes source/test paths. Passing these gates establishes scenario inventory and source integrity; Promptfoo text screening does not qualify a runtime or replace governed execution/security tests.

Run the deterministic source and case-binding gate with:

```sh
pnpm check:platform-skill-operating-knowledge
pnpm test:platform-skill-operating-knowledge
```

Run the current retained Promptfoo scenarios with the existing provider contract using `pnpm evals:platform-skill`. The command loads the exact current release files, includes only the one-level reference named by each scenario, reads the existing Promptfoo provider list, and passes all baseline and reviewed field cases to that runner. It makes model calls when invoked with configured provider credentials. Do not run it as part of offline source checks.

The corpus currently contains 48 contract scenarios and **zero production/support field regressions**. No genuine reviewed source case was available to seed, so none is represented as customer evidence. To add one, a Platform Skill owner manually reviews a confirmed failure and adds a structured entry to `cases.json` under `fieldRegressionCases`: choose an existing `scenario` enum and bounded signals; include only `sourceKind`, a SHA-256 digest of the reviewed source, `reviewedByRole: "platform_skill_owner"`, a canonical UTC `reviewedAt`, `privacyReview: "sanitized_scenario_only"`, and `copiedTranscript: false`. The checker rejects extra fields, freeform prompts, raw IDs, paths, URLs, credentials, and transcripts. The scenario is then executed by the same Promptfoo runner. There is no automatic collection or writeback from Feedback, Support, incidents, telemetry, or Learning.

Promptfoo text checks are screening evidence only. Before any model call, the runner measures package assets and references inserted per scenario, exact prompt bytes, and estimated input tokens; the six efficiency scenarios separately map included package assets, reference loads, tool-call observability, runner retries, context size, and provider latency/token/cost diagnostics. These measures set no efficiency pass threshold. Runtime Skill activation, tool calls, provider-internal retries, and external side effects require runtime instrumentation and are not inferred from prompt construction. Promptfoo reports provider latency, token use, and cost when a live eval is explicitly run. Existing authorization and execution behavior remains enforced and tested by the current Native/Tool Gateway/adaptor owners and the governed `SkillEvaluationService`; this audit creates no second promotion policy.

Current profile boundaries are explicit: Native delivery source exists, while installed-runtime/customer qualification remains open; OpenClaw and Hermes are not claimed as GA here; A2A/custom runtime equivalence remains unknown and unqualified. The release registry's generic compatibility field does not qualify a runtime. No current source register supplies the GA profile inventory, so the audit does not manufacture one.


## Coverage qualification

The 48-case baseline has a source-checked mapping for every §21B.28 item: explicit, implicit, contextual, negative, near-miss, overlap, many-Skill, and context-pressure routing; canonical tool selection, no invented capability, relevant-reference loading, direct/proposal/confirmation/Human-only modes, current-state/version checks, postconditions, and durable waiting; each listed authorization/security branch; all ten listed recovery branches; six efficiency measurement dimensions; and the Native missing-Skill admission case. The gate fails if the baseline case inventory or one of these six efficiency dimensions is removed or duplicated.

The runner remains a text-only Promptfoo harness. Current profile boundaries are explicit: Native source exists, while installed-runtime/customer qualification remains open; OpenClaw and Hermes are not claimed as GA; A2A/custom equivalence is unknown. No common cases are claimed as run on GA runtime profiles because the current source register supplies no GA profile inventory. Full runtime conformance and field regressions remain open until exact profile qualification evidence or real reviewed production/support failures exist. No field case is fabricated.
