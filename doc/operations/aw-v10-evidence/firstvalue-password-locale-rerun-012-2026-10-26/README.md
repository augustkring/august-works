# First-value and password reset rerun attempt 012

The fresh list gate found exactly two tests. The first-value recovery test passed after replacing the stale August Works brand literal with an English-heading pattern that accepts the current configured product name.

The password reset test failed because `getByLabel("New password", { exact: true })` did not match the input's full accessible name: the helper text is nested inside the same `<label>`. The screenshot showed the English password form and field. The test selectors have since been changed to the `^New password` prefix. The password reset case was not passed in this attempt, so this record is not a passing two-test run.
