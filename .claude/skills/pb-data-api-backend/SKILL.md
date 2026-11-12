---
name: pb-data-api-backend
description: >
  Routes database, API and backend-service work to the right chapters of
  playbooks 12 (Data/Database), 13 (API/Distributed), 15 (Backend) and 22
  (Language/Runtime) without loading them whole. Use when changing Drizzle
  schema or migrations, transactions, concurrency, queues, jobs, schedulers,
  retries, idempotency, webhooks, external integrations, or TypeScript/SQL
  conventions.
---

# Data, API and backend playbook router

Each playbook is 25k-40k tokens. Never read one whole.

## How to read

1. Open the index under `doc/reference/aw-v9/playbooks/index/` (files start with `12_`, `13_`, `15_` or `22_`).
2. Read only the line range of the chapter named below, using `sed -n 'START,ENDp' <playbook>`.
3. Repo rules come first: `AGENTS.md` sections 5 and 6 (company scoping, contract sync across
   db/shared/server/ui, the migration workflow) and `doc/DATABASE.md`.

## Which chapters, by change type

| Change | Chapters |
|---|---|
| New table or column | 12: 8 Data modeling, 9 Identity/keys/nullability/time, 10 Integrity, 24 Multi-tenancy |
| Migration | 12: 23 Schema migration, 37 Migration release standard. 15: 23 Release, migration and change safety |
| Transaction or lock behaviour, races | 12: 11 Transactions, 12 Isolation and concurrency, 35 review standard. 13: 29 Locks, leases, fencing |
| Query is slow or unbounded | 12: 17 Indexes, 18 Query and data-access performance |
| Backup, restore, repair | 12: 20 Backup, 21 Restore and DR, 22 Corruption and reconciliation, 36 readiness |
| Tenant isolation proof | 12: 25 Tenant isolation verification, 38 Multi-tenancy review |
| HTTP route or contract | 13: 8 Contract engineering, 9 HTTP API, 41 Versioning |
| Retries, timeouts, idempotency | 13: 19 Idempotency, 31 Retry, 32 Deadlines and cancellation |
| Queues, jobs, workers, schedulers | 15: 9 Jobs, 10 Workers, 11 Queues, 12 Scheduling. 13: 35 Queue health, 36 Dead-letter |
| Long-running workflow, recovery after crash | 13: 25 Saga, 27 Outbox/inbox. 15: 24 Operations, repair, replay |
| Fairness between tenants, overload | 15: 15 Overload, fairness, backpressure. 13: 34 Backpressure |
| Webhooks, provider integrations | 13: 13 Webhooks, 38 External integration, 39 Reconciliation |
| TypeScript or SQL style questions | 22: 8 TypeScript profile, 17 SQL profile, 27 Review checklist |
| Backend readiness or audit | 15: 28 Production readiness gate, 29 Audit standard. 12: 30 Production readiness gate |

## Output

For each finding, report file:line, the chapter, the failure scenario (inputs leading to a wrong
result), and whether an existing test covers it.
