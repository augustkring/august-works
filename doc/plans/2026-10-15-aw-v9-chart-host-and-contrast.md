# Correct the Native chart host and subtitle contrast

The first integrated chart browser case reached the Native dashboard but the
empty company's inherited first-Agent wizard opened over it. The keyboard-opened
table and its focused scroll region were present; the wizard blocked the next
interaction. Preserve the timeout and screenshot as a fixture failure. Seed one
actual idle process Agent with heartbeat and on-demand wake disabled, as the
Native host requires. Keep the same keyboard, value, width, theme and WCAG checks;
do not force clicks, change the feature or relax a test limit.

That corrected fixture then found a genuine light-theme contrast failure in the
three ChartCard subtitles. Remove only the 60 percent opacity modifier and use
the existing muted-foreground token. Do not add a raw color or reduce contrast
acceptance. Preserve this independent contrast failure and its screenshot.

With both fixes the production-built host passes the browser case: keyboard
opening and focused horizontal scroll region, exact counts and failure reasons,
no-run versus zero-rate semantics, 320px document containment, both themes and
all requested automated WCAG tags. Reload does not start an Agent run. Focused
chart/locale tests pass 15 cases and token gates pass. Manual screen-reader,
zoom, representative usability and the complete graph/generative-host matrix
remain open. The full current browser repeat is pending.

Checkpoint77/79 full typechecks and builds pass. Their duplicate UI runs were
explicitly interrupted (143), never counted as passed. The checkpoint81 current
full UI/CLI continuation remains the broad UI proof; the later production delta
is this one existing-token class change, tested here. The checkpoint79 full
browser attempt was interrupted after its known chart fixture failure; earlier
passes do not turn that attempt green. All original logs and artifacts remain.
