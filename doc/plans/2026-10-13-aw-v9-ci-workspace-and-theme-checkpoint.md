# Bounded workspace baseline and theme completion

The runner workspace-diff test assumed its two-file filesystem baseline would
always finish within the optional production admission budget of 100 ms.
That assumption failed on a shared GitHub runner. The service now accepts a
trusted host budget between 1 and 1000 ms, while preserving the 100-ms default.
The positive actual-filesystem fixture explicitly uses 1000 ms. This option
is not exposed in HTTP or model turn input, and is retained across session
restoration. A deterministic blocked-capture fixture proves default deadline
expiry still admits the provider, aborts capture and records no fabricated
diff. Diagnostic content remains withheld under the existing redaction policy.
The affected live-session suite passes 43 cases, including invalid budgets.
The CI log alone cannot independently prove why that specific baseline was
unavailable; the deadline is an exercised permitted path, not an inferred
successful capture.

The browser theme helper now captures each animation's completion promise
before inspecting timing, because the style flush can cancel a transition
and replace its finished promise. Captured promises settle on completion or
cancellation. Native animations stay enabled and the existing autofill hold
exclusion remains exact. Actual joint and initiative planning journeys passed
twice each; GitHub must confirm the repair on the published commit.
