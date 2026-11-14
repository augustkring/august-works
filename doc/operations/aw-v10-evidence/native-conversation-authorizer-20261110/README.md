# Native conversation authorizer transaction — 2026-11-10

Sandbox execution authorization already holds the company privacy locks and an application connection. Its two conversation-workspace lookups now reuse that transaction. Previously those reads requested another connection from the root pool while concurrent input acknowledgment and event readers could occupy the remaining connections waiting for the held locks. The standalone lookup outside this transaction remains unchanged.

A separate diagnostic pool exposed one idle transaction holding both privacy keys and two blocked application connections. The temporary writer/backend probe was removed before this qualification. The actual managed OpenCode/runnerd case now completes with a real controlled provider response and reservation, while refusing stale conversation generation and a removed Human session before either additional reservation can dispatch. All original assertions remain.

Canonical public startup span names survive the existing exact-name redaction allowlist. Unknown dotted strings and hostnames remain redacted. The diagnostic projection emits only bounded name, duration and outcome facts and does not label a completed span as the current phase.

The packet contains 32 unique passing cases: one actual SDK software case and all 31 redaction/projection cases, plus a passing final server TypeScript check. Exact source/input pins, resource limits and normal owned-process cleanup are retained. Raw protocol logs and failed exploratory runs are excluded. This is not full-suite, external-provider, physical-Host, whole-brief or release acceptance; requirement and phase statuses remain unchanged.
