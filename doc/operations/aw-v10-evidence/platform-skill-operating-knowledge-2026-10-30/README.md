# V10-145 Operating Knowledge review — 2026-10-30

Reviewed and expanded the uncommitted V10-145 audit against brief §§21B.28–.31 and 43.15, LOCK-1051–1054. The baseline now has 48 bounded scenarios mapping every enumerated §21B.28 software scenario family: eight routing/reachability cases, ten procedural cases, thirteen security/authorization cases, ten recovery cases, six efficiency dimensions, and the Native missing-Skill admission case. The checker requires the complete case ID inventory and all six efficiency dimensions, so removing or duplicating a mapped scenario fails the local gate.

## Review result

The source-integrity gate binds the current reserved release and exact Skill package contents, current Operation Manifest hash, one-level case references, current Skill lifecycle/promotion owner, runtime delivery/test source paths, and explicit runtime qualification boundaries. Field regressions require a closed schema, bounded scenario and signal enums, linked digest-derived IDs, reviewer/time/privacy attestations, and prohibit raw locator/transcript fields. The field corpus remains empty because no confirmed privacy-reviewed production/support regression was supplied.

The eval runner uses the existing Promptfoo provider contract and current immutable release. Its offline preflight checks all 48 scenarios across four existing providers without calling models. Before invocation it measures package assets and relevant references included in each scenario, exact UTF-8 prompt bytes, and an approximate token count (bytes divided by four). It exposes zero tool adapters, invokes the runner once with no runner retry policy, and reports Promptfoo token/cost/latency diagnostics during an explicitly run provider evaluation. Runtime Skill activation, provider-internal retries, and external effects are not observable in this text-only harness. These diagnostic measures set no efficiency pass threshold.

Native delivery source is present and the referenced admission tests contain positive admission plus stale/contract mismatch and denied-principal assertions. Installed-runtime/customer qualification remains open. OpenClaw and Hermes are not claimed as GA; A2A/custom equivalence is unknown. No common cases are claimed as run on a GA runtime profile because the current source register supplies no GA profile inventory. This is a software scenario and source-audit result, not external runtime qualification.

## Checks

- `node --test scripts/platform-skill-operating-knowledge.test.mjs` — pass, 4 tests, including a mutation check that rejects provider options the runner cannot preserve.
- `node scripts/check-platform-skill-operating-knowledge.mjs` — pass, 48 baseline scenarios, 0 field cases.
- `node scripts/run-platform-skill-evals.mjs --check-only` — pass, release v3, 48 scenarios, 4 providers; no model calls. Preflight measured 43 relevant reference insertions, zero unrelated reference insertions, 310,416 UTF-8 prompt bytes, 77,604 approximate input tokens total, and 6,626 maximum bytes in one scenario.
- `git diff --check` — pass.
- `node scripts/check-aw-v9-coverage.mjs` — pass, 70 surfaces. Its output says 70 remain pending implementation/evidence and explicitly does not claim release acceptance.

A live provider/model evaluation was not run, so there are no model outcome, provider latency, or cost results. No network/model calls or evaluation spend occurred.

## Source pins

`source-pins.sha256` records the reviewed brief, audit/corpus/runner/checker, current v3 release and registry, Promptfoo provider contract, operation manifest, runtime/promotion source and test owners, and CI integration paths and the current mounted-UI operation inventory used by the aggregate check. The source worktree base is commit `fcec9c5a5e2a7eb7a3cdfd50d54de96a49a8e1ff`; the reviewed files were uncommitted. Recompute the pins if any input changes before commit or merge.
