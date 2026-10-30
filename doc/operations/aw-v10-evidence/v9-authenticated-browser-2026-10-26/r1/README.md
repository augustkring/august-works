# Authenticated V9 workflow receipt browser check

This run uses the default Playwright configuration with the actual authenticated signup/bootstrap Human session and isolated browser cookie storage. The browser journey proves same-request workflow test recovery after a lost response, reload receipt visibility, idempotent replay, and no duplicate execution.

The test now binds all expected-user query parameters and the intercepted request URL to the real session principal from `/api/auth/get-session`; the original recovery assertions are unchanged.

Snapshot, syntax, socket-preflight, Playwright list, test log, and exits are included. Snapshot/syntax/socket/list all exited 0; one Playwright test passed; overall exit 0. This is a software fixture; it does not establish hosted email delivery or production usage.
