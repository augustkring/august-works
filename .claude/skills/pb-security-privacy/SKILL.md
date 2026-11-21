---
name: pb-security-privacy
description: >
  Routes security and privacy work to the right chapters of playbooks 06
  (Security) and 07 (Privacy) without loading them whole. Use when changing or
  reviewing authentication, authorization, tenant/company isolation, sessions,
  secrets, input handling, agent/tool permissions, personal data, telemetry,
  retention, deletion/erasure, exports, consent or subprocessors.
---

# Security and privacy playbook router

Playbook 06 is about 70k tokens and 07 about 30k. Never read either whole.

## How to read

1. Open the index: `doc/reference/aw-v9/playbooks/index/06_security_engineering_v2_golden_master.md`
   or `.../index/07_privacy_data_protection_engineering_v2.md`.
2. Find the chapter named below and read only its line range with `sed -n 'START,ENDp' <playbook>`.
3. For a review, read the matching checklist section and check each item against the diff.
4. Repo rules win where they are more specific: `AGENTS.md` sections 5 and 8, and the
   V10 locks in `doc/reference/blentera-v10/index.md` (LOCK-1008, 1011, 1012, 1014, 1029).

## Which chapters, by change type

| Change | Playbook 06 | Playbook 07 |
|---|---|---|
| New or changed API route | 18 Authorization and tenant isolation, 22 Application/web/API; checklist 41.5, 41.7 | 29 Multi-tenancy |
| Login, SSO, passkeys, TOTP, recovery | 17 Identity and authentication, 19 Sessions and tokens; checklist 41.4 | 17 Rights and user control |
| Secrets, keys, encryption | 20 Secrets, cryptography and key management; checklist 41.6 | 26 Security controls that support privacy |
| Parsing, prompts, file upload, HTML/markdown rendering | 21 Input, output, parsing and interpreter security | - |
| Agent tools, MCP, delegated authority | 32 AI, LLM and agentic security; checklist 41.11 | 25 Agentic systems and privacy |
| Billing abuse, quotas, approvals | 23 Business-logic security, abuse and fraud | - |
| Admin, support access, break-glass | 27 Configuration, defaults, admin, support | 13 Access and internal use |
| Logs, telemetry, analytics | 29 Security logging and monitoring | 14 Telemetry, observability and privacy |
| Deletion, erasure, exports, retention | 24 Data and storage security interface | 15 Retention, 16 Deletion and erasure, 41 Data migration, 42 Backup and DR |
| Vendors, model providers, regions | 26 Supply-chain interface | 19 Processors and subprocessors, 20 Cross-border and residency |
| Release or beta readiness | 41.12 Production security readiness checklist | 39 Privacy readiness checklist |
| Pull-request review | the checklist that fits, under chapter 41 | 40 Change / pull-request privacy review |

## Telemetry paths

Before you touch telemetry, read `AGENTS.md` rule 7. Telemetry, observability and the run log
each get a different level of review.

## Output

In a review, report each finding with: file:line, the rule (for example
"06 §18 tenant isolation"), the concrete failure scenario, and its severity. Leave out general advice.
