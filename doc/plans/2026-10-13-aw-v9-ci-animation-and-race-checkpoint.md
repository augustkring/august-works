# CI animation settling and deterministic privacy assertions

The causal-model browser journey reproduced the CI timeout with two SVG color
transitions already cancelled by a style flush. Reading `Animation.finished`
after cancellation obtains a new promise for the idle animation, which never
settles. The browser helper now observes each captured finite animation's actual
`finished` or `idle` state on animation frames. Active transitions still run;
the existing infinite-animation and native autofill-hold exclusions remain.

All six actual built causal-model and cross-project-planning journeys passed
with two repetitions, including light/dark accessibility checks. The causal
worker used the repository's exact hashed Python dependency lock. A temporary
deadline probe established the cancelled SVG state and was removed before this
fix; its deliberately failed run is diagnostic evidence, not acceptance.

The Workflow projection privacy assertion compared a short private fixture
value against every substring of the JSON response. A legitimate random UUID
contained the same `c-1` sequence. The assertion now checks the exact quoted
JSON value alongside every prohibited private field name. Projection behavior
and privacy boundaries are unchanged.

The concurrent audience-cleanup test now verifies that its own cleanup backend
is waiting on the membership lock, using `pg_backend_pid()`. Observing any
waiting backend did not establish this transaction's order. This strengthens
the fixture without changing the production audience authorization service.
The original three focused race cases passed locally, followed by all 371
tool-access and Workflow route cases with the stronger fixture and privacy
assertion. The remote race failure has not been independently reproduced; the
next CI run must qualify the integrated result.

References: verification, reliability, security and frontend playbooks. This
checkpoint repairs software qualification and does not establish complete V9
implementation, a human pilot or hosted provider acceptance.
