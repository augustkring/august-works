# Current CI UI harness correction

## Observed failures

On source `407e28d39557ee3fe72932652a4ad4237a4a410e`, GitHub job
116329692110 failed CompanySettings.test.tsx:252 while waiting for the environment
form. The suite labelled a flushSync wrapper as act, but it did not use React's
async act to flush routing/effect work. Use React's actual act. Retain the same
twenty-turn assertion loop, five-second case deadline, real component, API
fixtures and all sandbox/local/SSH ordering assertions. All four cases pass and
the complete UI typecheck passes. No production environment code changes.

Browser job 116329691654 timed out before opening the erasure dialog. The retained
report shows the first row-focus action waiting while the company-entry form is
empty. Cleanup then used Playwright's already-closed request context and obscured
the primary failure. The precise original cause is not established. Three
unchanged traced local repetitions pass; this is not proof of a production fix.

## Stronger browser checks

Require the entered company value, an enabled queue action and a visible original
feedback row before exercising keyboard actions. Keep the entire unknown-erasure,
same-request retry, account recheck, reload, confirmation and unchanged Native
fixture assertions. Keep the original one-minute journey limit. No input or
mutation is automatically repeated after a failed action.

Preserve a primary journey failure if disposal also fails after context closure.
Annotate incomplete disposal of the isolated software fixture. A successful
journey still fails if its cleanup fails. Three traced repetitions of this
stronger journey pass in 51.3s total. Root-cause uncertainty remains explicit.

## Evidence and final gate

The CI artifact is retained as GitHub artifact 11959517014, SHA-256
64283ade9593e1f8be964c0d4df4d28055706ef2f10aabbab6199223e52efe35.
The original remote attempt is not a pass. GitHub refused an individual rerun
while its parent workflow was active. The new test source requires a new full
CI result; no old or unexecuted result is promoted to a current-head pass.
Engineering workflow/review and verification playbooks require real state
completion and inspectable failure evidence. These corrections do not establish
host/provider, manual AT, Human usability or V9 release acceptance.
