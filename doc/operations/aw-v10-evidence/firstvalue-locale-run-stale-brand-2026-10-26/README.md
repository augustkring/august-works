# First-value locale/branding diagnostic attempt 009

The fresh source list gate found exactly two focused tests. With `--max-failures=1`, the first-value test failed and the password-reset test did not run. The page was English; the heading contained the current product brand “Blentera”, while the fixture expected the stale literal “August Works”. The saved goal was visible. The test locator has since been updated to match the English heading form while allowing the configured product name.

This attempt is not a passing regression run. The raw test output, source pins, and Playwright error context preserve the failure evidence.
