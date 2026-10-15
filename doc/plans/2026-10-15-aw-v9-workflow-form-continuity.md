# Preserve unsent workflow reviews during account checks

Status: implemented. Deterministic route-entry regressions reproduce the step,
flow and run-control resets before their fixes. The four related suites pass
all 47 cases. UI typecheck, token, module and source-coverage gates pass.
Current built-browser and complete integrated qualification remain pending.

## Problem and result

Checkpoint 70 passes full workspace types/build and all 7,927 UI tests in 804
suites without skips. Its complete 89-case production-browser run ends with
88 passes and one failure. A condition edit saves the changed expression but
silently restores the previous step name. Its route entry unmounts the form
during a current-session check. The same pattern is reproduced in the flow
builder and retained workflow Stop acknowledgement. The earlier orchestration
Stop fix remains covered by the combined regression.

Keep each existing company/principal/workflow/node/run-keyed workspace mounted
when the same cached principal remains available. Its original private-read
authority still removes the private form during the session check and requires
a new Native read before presentation resumes. Another principal remounts it.
A changed Native revision retains the unsent text but blocks saving until the
Human explicitly reviews the new source. Session failure offers original-session
retry only. Input stays in React memory, and is not added to browser storage.
Existing current-account, Native revision, source, permission, one-request and
original receipt checks remain authoritative.

The actual migrated-HTTP wait/condition browser fixture now deliberately holds
both the session response and the subsequent Native draft read after editing
the name. It asserts private withdrawal and name continuity before its existing
validation, single lost-response save, unchanged live revision, original request
recovery, rollout-withdrawal and Danish mobile accessibility checks.

## Original CI selector defect

The failed PR-38 job 115445587156 from run 38440297066 uses source
5dc6bce6b904597d105dbab9faf0cb7df7ea63cf. Its downloaded browser report has
SHA-256 b600ba51bdf4dc7163d3f7e4b55eb296422a9dae3b28bc3c0c96e8155363ae94,
matching GitHub artifact metadata. Two onboarding failures show a visible main
task heading and a hidden sidebar text label. The broad first-text locator
selects the hidden label. The test now checks the exact heading in main.

A copied-original diagnostic on checkpoint 69 forces the progressive shell:
both old locators fail, and both corrected locators pass (1.3 minutes). Only
the locator changes between those runs. First-task persistence, navigation and
no-dashboard-bounce assertions remain. The old feedback-erasure timeout is not
assigned this cause; its current-source case passes separately and in the
checkpoint-70 aggregate. Original failures and screenshots remain retained.

## Assurance and remaining acceptance

V9 V3 sections 83.4, 83.9 and 86 and the SDLC, construction, verification,
privacy, UX and frontend playbooks guide this bounded correction. This is
presentation continuity, not a new authority, grant, writer or deployment.
No schema or Native server/package/build configuration changes.

The frozen checkpoint-69 general shard 1 passes 9,571 cases (22 skips;
459 passing suites, three skipped; 4,022.93 seconds). Remaining original runner
groups are still in progress. These are software fixtures, not real Human,
host, provider, field-performance or live-channel qualification. Whole V9,
all 70 launch evidence rows and R0 remain open. No PR/push.
