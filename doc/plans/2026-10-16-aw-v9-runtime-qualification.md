# V9 runtime qualification and release prerequisite repair

Application baseline: merged master `9f1003e75a250f4bb43a9ef4d4d62b45cccc9448`.
No application implementation changed in this follow-up. The V3 brief §64 and
§86 retain Native runtime authority and predecessor obligations. Playbook 05
§§3.1–3.2/8.1 require claim-specific evidence; Agentic Engineering §45 requires
actual kill/revoke and partial-effect recovery, with independent user evidence.

## Concrete release-control defect

A synthetic complete 47-surface portfolio made the former `--release` check
return success while the actual V7 register still declared all three mandatory
implementation blockers incomplete. Four initial negative cases failed against
the old checker. The checker now reads canonical V7/V8 registers, requires each
known blocker and H6/H7 gate exactly once, preserves additional incomplete V7
blockers, requires V8 source and hosting declarations, and requires a named V9
acceptance owner. Missing/malformed registers fail closed. New refusal logs do
not echo unknown register values. Ordinary source checks remain available.

A later regression exposed truthy string `sourceComplete` and untyped schema
identity acceptance. Both now require their declared types. All nine CLI cases
pass, including a complete positive synthetic portfolio and a return-to-positive
identity case. A test fixture initially shared its hosting-ID array; it now
copies that array so removing a gate cannot contaminate later cases. The
identity regression was reproduced after that fixture correction before the
production type checks changed. The V9 workflow runs this suite and watches
both predecessor registers and the new helper/test paths.

## Executed local qualification

The [checkpoint manifest](../experience/v9/evidence/2026-10-16-runtime-qualification/manifest.json)
retains test-source hashes, passed/excluded counts and local log hashes.

- Runtime/sandbox/model reservation/worker gateway and V9 recovery: 128 passed;
  one real-dump case initially skipped because its required client image was
  absent. No passing physical sandbox or managed autonomous transport is inferred.
- Actual PostgreSQL dump, authenticated archive and quarantine restore: the
  separate rerun passed after pulling the unchanged pinned client digest. It
  checks session/key revocation, preserved budget pauses, explicit identity
  rehomes and post-backup erasure replay. The existing non-root/private-PID test
  wrapper additionally mounts the normal Docker socket for this owned test.
- Native channel contracts: five passed (closed Slack question/continuation,
  retryable exact signed Stop, guest/stale Stop refusal and Slack/Teams binary
  confirmations); 1,043 other cases excluded. Provider transports are fixtures.
- Host CLI, reduced motion, actual token contrast, pilot/attention validators
  and V7 readiness: 53 passed. These are automated software controls.
- Built recovery/Stop browser journeys: six passed across runtime, workflow,
  connection, unknown workflow-request recovery and retained Stop with rollout
  disabled. Keyboard and axe assertions remain. The first invocation exhausted
  temporary disk before tests. Inactive synthetic browser PostgreSQL clusters
  were removed after process/file-reference checks; the corrected invocation
  passed without changing a guard, assertion or deadline.

## Remaining implementation and operating boundaries

The earlier statement that only acceptance testing remained was too broad.
These are actual inherited code obligations, not merely missing screenshots:

1. `native_openshell_host_bridge`: physical prepare/apply/start and complete outer
   enforcement remain closed. Native `native-host-bridge.ts` refuses apply/start;
   `deploy/v6/host-agent/openshell.mjs` returns no complete capability snapshot.
   The pinned OpenShell lifecycle API has no atomic sandbox-ID precondition;
   observing a name and then acting on it cannot establish that guarantee.
2. `credential_use_broker_and_revocation`: policy projection explicitly refuses
   per-use credential bindings. Physical executable identity, destination-bound
   injection, secret-version revocation and enforcement must be implemented and
   qualified; connection inventory is not broker authority.
3. `pre_spend_model_reservation`: the bounded Native internal-draft gateway is
   implemented and locally verified. Forced transport for broader autonomous
   CLIs/sessions and physical workload admission remain incomplete and closed.

`evals/aw-v7/pilot-readiness.json` remains the canonical blocker register.
V8 still declares incomplete source/claims and open H6/H7 obligations. These
states are not cleared by V9 surface tests, operator labels or this guard repair.
Full V9 release-bound surface evidence, hosted/provider operation, representative
Human usability, manual screen-reader execution and the legacy support/usage
window remain open as required by the brief.

Current supported environment discovery exposes no provider identities, secret
bindings or runtime variables. GitHub reports no deployment or environment.
Repository secret-name metadata is also unavailable to the GitHub integration
(403); no secret values were requested. The documented initial origin's health
request receives CONNECT proxy 403,
without a target response. This does not prove no installation exists; it does
mean this executor cannot qualify it. No credential discovery, provider send,
production deployment, paid action or rollout activation was performed.

Readiness stays R0, `sourceComplete: false`, with no accepted release identity.
The local checkpoint is recorded separately. All 70 formal surface evidence
rows remain open. Full recursive workspace types and the complete production build pass on this
patch. The final 61-case script selection passes after the fixture-source
follow-up. The local monolithic default catalog was not repeated for this
release-script-only patch; current PR jobs must run the unchanged catalog.
Previous PR checks are not credited to this patch. Current PR checks/review
remain pending until their exact-head results are recorded in the PR.
