# Native chat attempt 031: SQL-contaminated run

This focused Playwright run used a fresh snapshot; snapshot, syntax, socket cleanup, and exact one-test listing passed. The browser test ran once and exited 1, but the result is not valid evidence about the chat source changes because the server’s shared issue-privacy authorization query fails globally with PostgreSQL `syntax error at or near "and"`.

The error appears in `canActorReadIssuePrivacy` before chat open; issue lists and issue read routes return 500. The generated query contains the plugin operation origin classifier. See the compressed raw log and source pins. This run is retained as contaminated, not a product test failure or pass.
