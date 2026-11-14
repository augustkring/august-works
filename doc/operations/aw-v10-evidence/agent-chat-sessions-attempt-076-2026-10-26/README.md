# Agent chat sessions attempt 076

This attempt is preserved as an interrupted, invalid-auth-mode diagnostic. It is not authenticated-session proof and is not a complete suite result.

The Playwright config listed exactly eight tests. Before running them, the server was inspected at `/tmp/paperclip-e2e-home-t3kdPf/instances/playwright-e2e/config.json`; it declared `server.deploymentMode: local_trusted`. The configured `onboard --yes --bind loopback` path maps loopback to local-trusted mode, despite the E2E environment declaring authenticated mode. The run was stopped with SIGINT after this was confirmed. The runner recorded exit 130.

The partial Vitest summary recorded four passed tests, one failed recovery test, one interrupted test, and two tests not run. The recovery failure expected the retained metric Memory record to be linked from the run context manifest. That snapshot already had the dedicated result-Context design; the failure exposed a stale test assertion that expected the result root on the bootstrap Context. It is diagnostic only, not proof of a product failure. The later test interruption occurred during the intentional shutdown and should not be treated as a product failure.

Files include the exact source pins, all preflight logs and exits, Playwright log, and Playwright outputs. The next attempt changes the authenticated E2E onboarding preset to `--bind lan` and asserts the generated config is authenticated before signup/login.
