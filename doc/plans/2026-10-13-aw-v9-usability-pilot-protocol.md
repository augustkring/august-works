# V9 exploratory pilot and confirmatory protocol

Full V9 remains incomplete. This harness validates manually recorded artifacts;
it has not enrolled people, executed a study or generated launch evidence.
`evals/aw-v9/readiness.json` stays unchanged. Software fixtures do not establish
representative usability, accessibility or hosted/channel qualification.

The template contains the fourteen critical journeys from brief §48.2. Its role,
surface and assistive slices are an initial research scope to review against the
actual launch populations. All release identities, Privacy references and freeze
time are deliberately unset. The template cannot execute as an approved protocol.
There are no invented confirmatory sample sizes or numeric launch targets.

| Journey | Intended outcome and native oracle to define |
| --- | --- |
| First outcome | Signup/company to a useful result with current independent human verification; usable-account timing must have its actual native baseline |
| Hire agent | Exact selected package, missing access, approved purpose, representative test and immutable publication; no automatic work/grants from saving |
| Connect required app | Only the needed retained subject and scope consent; restore revoked access through the Original connection owner |
| Channel outcome | Employee receives the correct authorized outcome in Slack/Teams without a dashboard dependency or private notification payload |
| Material approval | The correct current human can approve/reject exactly the pending effect; stale/unknown decisions cannot replay |
| Correct result | Correct the specific result and understand what the declared future effect changes; no unapproved learning or Memory write |
| Workflow publish | Chat-authored explicit graph to safe test, immutable publish revision and current trigger/control; live version does not change on draft edit |
| Connection recovery | The actual own fixed subject recovers access; another user's credential cannot qualify the caller |
| Blocked agent | User identifies the real current blocking condition and authorized next step without private reasoning or raw errors |
| Stop work | Current drain/cancel/stop affects the captured native work identities and stays revoked despite stale/unknown responses |
| Manager decision | Current risk/insight is understood and produces the intended owned decision/task without treating a prediction as authority |
| Restrict permission | Authorized admin narrows the actual native permission; retained/stale actors cannot continue the protected effect |
| Downgrade Free | Concrete capacity consequence is understood while core data/governance stays with its Original owners |
| Assistive completion | Critical web journeys complete with keyboard, screen reader and 200/400% zoom/reflow in representative conditions |

First run exploratory sessions to discover failure modes and effort/time/confidence
distributions. Record actual native/security/privacy/accessibility oracles rather
than substituting a facilitator's impression. Preserve missing/censored outcomes;
do not drop them to improve completion. A task-start timer is not a usable-account
TTFO timer. If that native baseline is unavailable, record `not_recorded` and a
null duration; the confirmatory TTFO finding remains inconclusive.

Before confirmatory collection, use the pilot to freeze population/critical slices,
material pass/fail/inconclusive claims, sample/repetition rationale, uncertainty,
required independence, named risk/waiver role and production follow-up references.
The supported strict rule requires all observed oracles and security/privacy/
accessibility conditions satisfied, no critical incident, declared independent
review, and the predeclared minimum in every explicit critical slice. No default
enrollment value is supplied. Any different acceptance portfolio must be implemented
and reviewed before data collection, never selected after viewing results.

Freeze the exact code, artifact, configuration, schema, policy, model inventory and
tool inventory digests. Compute the canonical protocol digest before the first
observation and retain that receipt independently. Each observation binds that
digest and a time after the freeze but before the Privacy approval expires. A
modified protocol, duplicate participant/journey/slice, undeclared role/surface or
missing condition cannot produce an accepted confirmatory finding. A waiver field
does not automatically turn FAIL/INCONCLUSIVE into PASS.

## Data processing contract

This is private pseudonymous research metadata, not anonymous population data.
Manual local JSON artifacts are the only input. They contain generated participant
labels, typed outcome/oracle/incident enums, coarse roles/surfaces/assistive modes,
timing, assistance and optional effort/confidence scores. Participant identity
mapping remains separately governed and never enters this dataset.

Purpose, Privacy policy, retention, lawful-basis reference, accountable Privacy role
and expiry must be supplied by the research owner before collection. The script
cannot certify those claims or set a legal duration. Apply the configured retention,
subject rights and research-access controls to the source records and independent
freeze/review receipts. No raw prompt, company/tenant ID, name, email, URL, customer
content, credential, model output, recording or replay is accepted. There is no
provider export, telemetry emission, endpoint or automatic collection. Session
replay stays unavailable; it requires a separate reviewed processing contract.

Inputs must be regular files owned by the process user with no group/other access.
The CLI rejects symlinks, oversized/unrecognized payloads and an existing output.
It writes an owner-only aggregate receipt, omits participant labels from it and
logs no source values on refusal. Keep the artifacts on the existing approved
deployment/research storage; this introduces no region or residency claim.

## Operator use

Prepare real private artifacts from the reviewed template, then validate with:

```sh
node scripts/validate-aw-v9-pilot.mjs private-protocol.json private-observations.json EXPECTED_PROTOCOL_SHA256 private-aggregate.json
```

The expected digest comes from the earlier independent freeze receipt. The CLI
does not compute-and-accept a fresh rule on behalf of an already observed run.
`EXPLORATORY` never becomes confirmatory evidence. `PASS` is scoped to the declared
manual record/rule; it is not a GA certificate or proof that the records are true.
Missing cells, unchecked conditions, absent TTFO baseline, missing declared
effort/confidence scores and insufficient independence stay `INCONCLUSIVE`; material failure/incidents stay `FAIL`.

The software checks use explicit synthetic fixtures only. They cover frozen-plan
integrity, missing/censored outcomes, incident/condition failure, participant
deduplication, source field leakage, local file ownership/modes/symlinks and output
overwrite refusal. Reference guidance: brief §48.1–48.3/§67.10; UX playbook primary
outcomes and guardrails; Playbook 05 representative claim-specific evidence;
Playbook 07 purpose, minimization, retention and rights.
