# Native adaptive planning

The initial provider is a pure bounded mathematical seam, not a company/project
owner. Only sanitized required tasks, explicit duration/capacity and separate
company-defined dimensions are admitted. No work telemetry becomes inferred
human productivity; no result grants staffing, budget or execution capacity.

Native V1 validates constraints and critical-path bounds, detects overcommit,
uses explicit lexicographic greedy ordering and generates a small-set Pareto
frontier. UTC-day windows are half-open. Equal policy values use stable task-key
order. A dependency cycle, impossible earliest completion, existing overcommit
or insufficient aggregate required capacity is mathematically infeasible. A
greedy allocation failure remains inconclusive because another order may work.
Unknown duration/capacity/order dimensions withhold a schedule.

Every result records provider/version, input/result hashes, policy, diagnostic
constraints, bounded budgets and optimality `not_proven`. The native provider
records runtime and independently validates every feasible returned schedule.
At most 200 tasks, 2,000 edges, 32 pools and 366 days are admitted; the Pareto
frontier is limited to 32 candidates and 24 separate dimensions per task.

The 12 kernel/provider tests qualify software mathematics and abstention. They
do not establish native source admission, persisted Roadmap proposals, human
approval, project mutation or hosted release. Those source owners must precede
a public product capability. Single-project proposals must use existing
`project_roadmap_proposals` and canonical review/apply. Cross-project proposals
are justified only when scope actually exceeds one project. OR-Tools remains
a later optional provider after demonstrated customer need.
