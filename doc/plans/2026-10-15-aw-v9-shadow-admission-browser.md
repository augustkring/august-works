# Wait for the Original shadow transition in the V4 browser journey

GitHub job 116319869798 on the published checkpoint88 failed the retained V4
optimizer journey. Its error-context artifact shows six completed runs but only
two shadow observations. The test clicked Start shadow and immediately issued
three runs through a separate API client. A click does not wait for the command
to commit, so the first run could correctly use the original transform before
shadow admission. The production owner intentionally ignores non-shadow runs.

Wait for the exact successful shadow POST and the original UI's shadow state
before producing observations. Keep all three output assertions, the exact
three-pass/zero-failure expectation, server evaluation qualification, denied
anonymous promotion and retirement checks. No production state machine,
assertion, timeout or observation threshold is changed. Verification is recorded
with the exact source and retained logs after running the affected built journey.

The accompanying component-browser coverage adds all four EN/DA app/page recovery
states to Storybook, and checks both themes at 320px with reduced motion, heading
focus, keyboard continuation, 44px controls, plain support links, reflow and full
axe rules. This is component/software evidence, not manual AT or human acceptance.

## Recorded local results

- Actual production-built V4 journeys: all three pass, exit 0 (1.1min).
- Production-built chart journey after finite theme transitions: passes both
  themes at 320px, exit 0 (44s). All original WCAG rules remain enabled.
- Storybook build: exit 0. Both component-browser tests pass, exit 0 (35.4s),
  including the four recovery states in both themes and all twelve prior cards.
- Checkpoint89 full types exposed an untyped mock assertion parameter. Its
  explicit unknown[] correction passes the complete UI typecheck. The complete
  workspace check/build is rerun separately; its outcome is not assumed here.
