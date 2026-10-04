# V5 author code review — 2026-10-04

PR: https://github.com/augustkring/august-works/pull/32

Reviewed baseline: `1c11d2eba422155aafc3b2940f59812587f869bd`.
This is a manual review by the implementation agent at the operator's request.
It is an author review. It does not constitute independent approval, a completed
CodeRabbit review, or a Greptile score.

## Findings and fixes

### P1: Viewers could reject or invalidate Roadmap proposals

`projectControlService.review` checked project read access before its decision
branches. Task mutation checks ran only when it accepted a current proposal.
A viewer could reject a pending proposal, or mark an outdated proposal stale
by either accepting or rejecting it. Those changes persisted governance state.

Require `tasks:assign` authority before every decision branch in the transaction.
The PostgreSQL regression covers rejection of a current proposal, acceptance of
a stale proposal, and rejection of a stale proposal. In each case, the viewer
can still read the proposal, receives 403 on review, and leaves the pending
proposal, review attribution and task commitments unchanged.

All three cases failed against the reviewed implementation before the fix.
The complete Playbook/Roadmap suite passes after the fix, including normal
operator acceptance and existing stale/concurrency controls.

### P1: A disabled resolver discarded required Role Pack Skills

With Role Packs and the runtime enabled but the Skill resolver disabled,
`agentRuntimeFabricService.prepare` used an empty Skill inventory. It created an
execution manifest even when the resolved Role Pack required a missing Skill.
The required Playbook path already blocked the analogous configuration.

Reject execution with 409 when the resolved Role Pack has required Skills and
the resolver is disabled. The PostgreSQL regression first checks that flag
combination and then enables the resolver while the required Skill is still
absent. Both must reject execution without persisting a manifest. The first
assertion failed before the fix because an execution manifest was created.

### P2: Role Pack publication and pinned assignment were disabled in the UI

The Role Pack APIs return version `state` (`draft` or `published`). The UI API
types and page instead read `status`. Version labels lost their state, the
publication button stayed disabled, and published versions could not be
assigned with a pin.

Use the actual `state` field in both API response types and all three page
checks. A real PostgreSQL/Chromium regression creates a company Role Pack,
adds a policy requirement, saves a draft, publishes it, and assigns that exact
published version with a pin. It checks the server's persisted response and
that publication is disabled after success. The pre-fix browser run failed
because the draft label omitted its state.

## Verification

The regression logs preserve the pre-fix failures separately from passing runs.
The affected runtime and Playbook/Roadmap suites pass all 19 tests. The related
Role Pack, Skill lifecycle and organization/provider suites pass all 17 tests.
The classic V5 browser suite passes all three tests: the new Role Pack flow
and the existing Roadmap and governed behavior flows. Recursive typecheck,
the complete build, UI token gates and module boundaries pass. No paid providers
are used.

The final source fingerprint excludes Markdown documentation only:
`118ed1c4c89a2593e4b2cd3e128e36d041f7c5ad9f1db8c06e28b64536fdb386`.
Final typecheck, build, browser outcomes and backup verification are retained
in the private effective verification report and recovery kit. Failed startup
and interrupted browser attempts are retained separately; they are not passes.

At the reviewed baseline, GitHub reports 64 successful checks, two skipped
Storybook checks, and one failed review check. All 29 stable-suite test jobs,
full build/typecheck, security gates and product browser lanes pass at that
exact baseline. The new review fixes require their own head checks.

## Scope and limits

The review focused on company and represented-human authorization, delegated
scopes, provider qualification/cancellation, immutable manifests and behavior
versions, Role Pack requirements, Skill evaluation/promotion, Playbook review,
portfolio adoption, Roadmap commitments, migration ownership and Studio API
contracts. This is a risk-focused review, not a claim that every changed line
was independently audited.

Dependency Graph is enabled. The rerun's **Dependency Review step passes**.
The overall review job fails later at `Generate commitperclip token` because
`COMMITPERCLIP_KEY` is absent. Its quality gates never run. The workflow uses
`pull_request_target` and checks out the base branch, so changing it only in
this PR does not repair that base-branch integration. No review gate is bypassed.

CodeRabbit skipped this PR because it exceeds its file limit and review capacity
is unavailable. Its successful status is not approval. There are no independent
PR reviews or verified Greptile 5/5 results at this observation.

All 20 V5 flags remain off by default. Actual pilot companies, provider profiles,
credentials, company libraries and a budget remain activation requirements.
Synthetic provider evidence is not a live qualification or pilot result.
