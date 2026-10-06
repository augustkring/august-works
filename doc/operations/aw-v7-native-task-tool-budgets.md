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

## Scoped HTTP credential dispatch

Scoped connected-tool HTTP calls now repeat the existing server-owned execution
guard after credential resolution and before every actual request. This includes
MCP initialization, its initialized notification, tool dispatch and OAuth/token
refresh retries. The captured native connection configuration, catalog version,
grant identity and credential references must remain current. Grant selection
reuses the existing audience, membership and delegation resolver; a call cannot
switch to a fallback grant while waiting. Successful replies repeat those checks
before publication. Railway's native SSH branch also repeats the guard immediately
before starting its command and before releasing its result.

The logical action still enters the existing ToolGateway policy, approval and
invocation ledger once. Protocol initialization and credential refresh do not
create extra tool actions or consume a second rate-limit slot. An already-started
remote effect can remain unknown after revocation; these checks fence subsequent
requests and publication, not physical remote execution.

Vercel token metadata updates are conditional on the native grant still being
active and unrevoked. Neither a successful token response nor an authorization
error can overwrite a concurrently revoked grant with an active or reconnect
state. An unsuccessful conditional update withholds the credential and dispatch.

Local tests use migrated PostgreSQL and private token/HTTP fixtures. They cover
actual native run cancellation, grant revocation during token acquisition,
initialization, refresh and response handling, destination changes, ordinary
native credential calls, successful refresh and the last native rate-limit slot.
They do not qualify a physical workload credential broker, executable identity,
secret-version revocation, local stdio confinement or forced managed CLI inference.
