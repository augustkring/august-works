GitHub repository access now has bounded periodic full reconciliation, durable identity/scope and retry facts, provider rate-limit handling, and bounded backlog progress without waiting another hour. Webhook events and in-flight snapshots retain the existing source/CAS fences. Known-object refresh remains explicitly separate from feed completeness.

Qualified source suites: access PostgreSQL11/11, lifecycle16/16, event delivery3/3, recovery13/13; DB/shared builds, server/UI typechecks and Oxc passed. Exact mirror/output restoration is preserved, including the later repair of an attempt cleanup guard. The archive contains full candidate/base copies, original logs, source pins and all restoration/publication receipts. Source-only evidence does not qualify live providers, a feed cursor, production load or GA.

qualified-working-source.sha256 includes the existing uncommitted Project witness in tool-access.ts; that separate hunk is intentionally excluded from this commit.
