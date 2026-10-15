# Preserve an unsent Stop review through a current-session check

Status: implemented; the entry-level failure is reproduced before the fix.
Ten DOM cases pass with the actual account/session hook. UI typecheck, token,
module and source-coverage gates pass. The actual production-UI browser case
passes its forced session/private-read, keyboard Stop, one lost-response POST,
Original-only recovery, rollout withdrawal and Danish mobile axe checks.
Full current-source types/build/regression remain pending.

The production-UI checkpoint-69 browser run ends with 88 passes and one failure.
The Stop form loses its reason while the same account is rechecked. The route
entry unmounts the whole form whenever the current session is unresolved.
A deterministic entry-level test reproduces the empty restored reason before
this fix. Increasing the wait would not restore that input.

Keep the existing company/principal/plan-keyed workspace mounted when a cached
principal remains available. Its original private-read authority still hides
all fields during the session check and requires a fresh Native control read
before presentation resumes. A different authenticated principal, company or
plan remounts the workspace. Local implicit access remains refused. A failed
session check offers an explicit retry through the original session owner.
The retry performs no control submission.

The reason and acknowledgement remain React memory only. They are not copied
into the request locator or browser storage. Existing fresh account, current
plan version, permission, acknowledgement, exactly-one POST and original receipt
recovery controls remain in place. No pause/stop effect is inferred from UI state.

Verification covers the real route entry, same-person session recheck plus a
separately delayed private read, failed-session recovery, another principal,
StrictMode, original lost-response receipt recovery and refusal semantics.
The browser case now forces the session/private-read boundary before its
existing keyboard Stop, original receipt, rollout-withdrawal and Danish mobile
accessibility checks.

References applied: V9 V3 §§83.4, 83.9 and 86; construction/SDLC, verification,
privacy, UX and frontend playbooks. The earlier checkpoint-69 aggregate remains
failed/incomplete. This patch does not complete the whole V9 brief, the 70
release-evidence surfaces or R0. No PR/push or live provider action.
