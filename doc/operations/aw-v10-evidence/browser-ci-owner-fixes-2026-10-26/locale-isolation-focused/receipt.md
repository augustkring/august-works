# Locale-isolated browser regressions

Current source snapshot was synchronized under `/workspace/v10-preparation/v10-pg-tests.lock` into `/workspace/v10-dep-qualification`; source head is recorded in `source-pins.json`.

The first focused Playwright startup did not reach a test: the embedded database encountered a stale PostgreSQL socket. `stale-postgres-socket-cleanup.json` records the verified cleanup. The PID was a zombie, `ss` showed no TCP listener on 54329, and the socket lock referenced a disposable E2E database path. Only `/tmp/.s.PGSQL.54329` and its `.lock` file were removed; the referenced database and prior logs were preserved.

The rerun used system Chromium and seven specs: Management Reviews, Process Findings, Core Maintenance, Connector Recovery, Conversation Authoring, Package Current Account, and Private History. Eight tests passed and one failed in 1.6 minutes. The locale-sensitive English/Danish screens passed with the new per-test account-locale isolation. `aw-v9-conversation-authoring` remains blocked on the private chat read route: the browser stays at “Loading conversation…” while `GET /companies/:companyId/chats/:agentRef` returns 404 through `assertIssueReadAllowed` for the existing private-admission-closed conversation. This is an unresolved product route issue tracked with the parent agent; no route guard or authorization policy was changed here.

The helper saves the actual session user's current `/api/auth/preferences` locale, sets English before each locale-sensitive test, and restores the saved preference in `afterEach`; tests still exercise persisted Danish selection inside their bodies. It does not change product language persistence.

`playwright.exit` is `1` because of the single private chat route failure; raw output and all source/cleanup provenance are retained.
