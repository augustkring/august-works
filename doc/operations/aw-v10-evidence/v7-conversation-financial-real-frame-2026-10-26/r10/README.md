# Conversation reservation offboarding diagnostic R10

This targeted run executed both actual-frame offboarding cases with bounded per-operation transition and retention-job diagnostics. Snapshot/syntax passed. The unknown-hold case now reached the canonical purge path and passed its expected denial after runtime erasure; the prior four-step global-queue fixture assumption was too short.

The known-cost case still failed after successful runtime erasure. The current Native run had no process PID/group or legacy controller boot/expiry, committed/unleased finalization, and a real local Stop receipt. A rollback-only call into the exact canonical `purgeCompanyContent` path returned PostgreSQL SQLSTATE `23514`; the test did not expose a constraint/message yet. R11 captures only a bounded allowlisted database rule/constraint identifier to isolate that trigger. No full offboarding acceptance is claimed.
