# Native Task tools in bounded V7 plans

Both native tool authorities now enter the existing `tool_invocations` ledger
before a plan-bound Task tool executes. Its PostgreSQL guard charges the same
`orchestration_plans.tool_actions_used` counter used by connected tools. A stable
company/run/call identity permits one dispatch. A completed or ambiguous call
must use the protocol's retained result; this boundary never resends an effect or
stores a second copy of the response. Arguments and results retain hashes only.

Current original human (including the existing local-board principal), company,
presence identity, permissions, Task/run ownership, native admitted attempt and
manifest, retained Memory, provider conformance, accepted plan topology, rollout
and original wall-clock limit are checked before and after dispatch. Draft writes
repeat this check inside the existing mutation transaction. Memory, plan, Task
and run locks follow the same order as reservation and supervision.

The qualification covers five same-Task read operations and assigned-tool catalog
search. `write_document`, `report_progress` and `request_human_input` are permitted
only for `internal_draft` C0/C1 plans. Document writes must use a declared output
key. These low-risk canonical bookkeeping writes do not authorize external
effects. General API calls, hiring, new projects/Skills, reassignment and other
unclassified native/connector paths are closed for these plans. Material actions
require their separately qualified exact action and approval boundary.

Assigned MCP execution retains its existing gateway classification, authorization,
approval and invocation ledger. It does not receive a second tool charge from
this wrapper. Catalog search, which does not dispatch through that gateway, does
receive a native charge. Ordinary native runs without an Orchestration Plan keep
their existing behavior.

Exhaustion pauses the plan and enqueues generation-bound Stop in the existing
supervision outbox. An ambiguous effect retains its debit and requires human
resolution. Revocation during a read withholds the output. Neither a receipt nor
successful provider/tool execution certifies Task completion or physical Stop.

Local migrated-PostgreSQL tests exercise the actual Task read/write handlers,
both native authority paths, concurrent duplicate calls, exhausted counters,
undeclared outputs, unqualified API paths and authority changes. This does not
qualify autonomous CLI model calls or physical OpenShell credential/network use;
the forced model transport and physical admission gates remain closed.
