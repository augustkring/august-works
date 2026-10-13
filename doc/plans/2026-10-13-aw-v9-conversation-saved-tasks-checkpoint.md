# Current conversation saved tasks and Native reset fencing

The conversation now shows bounded references to tasks actually saved by the
Original Native `create_task` command. Provenance must match the current
conversation, Agent, responsible user and session generation, and the actual
saved semantic mutation receipt must name the same task. Arbitrary links and
matching origin fields without a receipt do not qualify. The owner returns up
to ten distinct current tasks plus explicit remaining coverage, with current
status/version and recorded execution-start evidence. It omits descriptions,
plans, prompts, credentials, run bodies and principal references.

The existing private, admitted read checks current task authorization and both
the task's and originating run's source authority. It locks/rechecks provenance
and the task, rechecks the conversation before returning, and suppresses hidden
tasks and earlier sessions. Task-only reads do not require workflow access.
Opening the surface has no model call, mutation, wakeup or automatic retry.
EN/DA links use the Original task editor. Live task changes synchronously hide
the old result; prior-account responses cannot restore it. Older servers report
task coverage unavailable rather than inventing a task result.

An actual PostgreSQL regression reproduced a separate mutation bug: a retained
Native run could save a task after its conversation generation changed. The
Original tool authority now checks the generation during discovery, under the
existing mutation locks, and before recording a new mutation receipt. A reset
after the real task insert rolls back the task, activity and receipt together.
Previously saved receipt replay also requires the current conversation.

## Verification and limits

The final six-suite Native/Original/private-client/widget run passed 79 cases,
including real backlog creation without wakeups, exact replay without duplicate
tasks, current task owner status, fabricated provenance, eleven actual saved
tasks with ten-result coverage, source erasure, old-generation commands/replay
and late-reset rollback. Server and UI typechecks passed. Token, module, source
coverage and diff gates passed; the coverage gate still reports all 70 surfaces
pending implementation/evidence, not release acceptance.

The built Chromium conversation journey passed with EN/DA, mobile reflow,
workflow/task links, no model runs or writes, and no axe violations in the
conversation region. This browser test supplies a bounded response fixture;
actual Native mutation provenance is independently tested against PostgreSQL.
It is not human assistive-technology or hosted/provider qualification.

General downstream Native task source erasure beyond this projection, the
remaining conversation target owners, managed representative transport,
capability/delegation mappings, channel cards and full V9 acceptance remain open.
No full-suite, source-complete, GA or merge-ready claim is made. References:
supplied requirements, backend, distributed systems, security, privacy,
verification, frontend, UI, UX and accessibility playbooks.
