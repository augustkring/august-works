---
name: pb-agentic-ai
description: >
  Routes agent-runtime and LLM work to the right chapters of playbooks 19
  (Agentic AI) and 18 (AI/ML/LLM systems) without loading them whole. Use when
  changing agent adapters, the Native runner, tool or MCP access, delegation,
  approvals, Stop/pause controls, sandboxing, memory, prompts and context,
  model routing or fallback, evaluations, or AI cost accounting.
---

# Agentic AI and LLM playbook router

Playbook 19 is about 48k tokens and 18 about 36k. Never read either whole.

## How to read

1. Open `doc/reference/aw-v9/playbooks/index/19_agentic_ai_engineering_v2_golden_master.md` or
   `.../index/18_ai_ml_llm_systems_engineering_master_playbook_v2.md`.
2. Read only the line range of the chapter named below.
3. Repo invariants come first: single assignee, atomic checkout, approval gates, budget hard-stop
   and activity logging (`AGENTS.md` section 5). V10 locks: LOCK-1009 model upgrades, LOCK-1012
   delegation, LOCK-1013 shared resources, LOCK-1038 no silent cross-region fallback
   (`doc/reference/blentera-v10/index.md`).

## Which chapters, by change type

| Change | Chapters |
|---|---|
| Who an agent acts as, credentials | 19: 10 Identity and principals, 11 Authn/authz/delegation |
| Tools, MCP servers, connectors | 19: 12 Tool and capability engineering, 13 MCP profile, 26 Threat model |
| Prompts, context, untrusted input | 19: 14 Context and instruction trust boundaries. 18: 17 Prompt and context engineering |
| Memory and learning | 19: 15 Memory engineering, 25 Data protection for agents |
| Task orchestration, durable execution, resume | 19: 16 Orchestration and durable state, 23 Idempotency and concurrency |
| Delegation between agents | 19: 17 Multi-agent systems and delegation |
| Approvals, human-in-the-loop | 19: 19 Autonomy, 20 Human oversight and approval |
| Stop, kill, pause | 19: 22 Stop, kill, pause and emergency controls |
| Sandbox, code execution, browser use | 19: 24 Sandboxing and computer-use |
| Model choice, routing, fallback | 18: 13 Model strategy, 20 Routing and cascades, 27 Reliability and dependency failure |
| Spend and budgets | 18: 26 Cost and resource engineering |
| Evals and acceptance | 19: 28 Evaluation and TEVV. 18: 18 Evaluation and acceptance evidence |
| Audit trail, run logs | 19: 29 Observability and forensic evidence (path rules: `AGENTS.md` rule 7) |
| Release readiness | 19: 30 Production readiness, 37 Operational checklists. 18: 31 Release and deployment |
| Incidents and recovery | 19: 31 Recovery and incident engineering. 18: 32 AI incident response |

## Output

For each finding, report file:line, the chapter, the authority or spend consequence, and the test
that would catch it.
