# Notification settings accessibility regression attempt 016

The fresh Playwright list gate selected exactly one test. Both the test and outer lock wrapper exited `0`; Playwright reported `1 passed (34.5s)`. The test retains the uncertain-command retry, destination persistence, rollout disablement, and default-only recovery assertions, then checks both light and dark themes at 320px with Axe and verifies no horizontal overflow.

The source pin includes two focused UI fixes: `.saas-row` checkboxes have 24px token-based dimensions for WCAG target size, and outline retry buttons inside `.saas-error` use the foreground text token so they do not inherit a low-contrast destructive color.
