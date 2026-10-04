# V5 architecture decisions

Global agent identity is the explicit exception to company-scoped domain rows.
It stores stable persona metadata and one home company; it grants no access.
Existing `agents` remain local presences. Keys, permissions, grants, budgets,
reporting lines and execution environments remain attached to the local row.
Cross-company access resolves and authorizes an existing local presence on every
use and intersects any represented human's current authority.

Provider identity is separate from logical identity. Profiles and sessions are
isolated per presence by default. Shared provider-local memory requires explicit
participating-company acknowledgement and is labelled reduced isolation. Provider
metadata is discovered deterministically and never treated as an access grant.

Runtime manifests pin immutable behavior versions and context provenance while
current permissions remain authoritative. Role Packs, Skills, Playbooks,
relationships and Org Units cannot grant authority. Skills evolve through
challengers and paired evaluations; Playbooks evolve through reviewed proposals.
Projection creates a candidate and cannot activate a Skill or approve a Playbook.

Project planning extends existing canonical projects/tasks. Planned, forecast and
actual dates stay distinct. Explicit baselines preserve commitments. Roadmap
edits use the same canonical fields and authorization as other task edits.
External sources have explicit field ownership, never a second write master.

All V5 flags default off. Additive schemas and retained audit records survive
rollback. Migrations expand, backfill in bounded batches, verify and cut over;
Drizzle owns generated schema snapshots. Existing V4 behavior stays compatible.

These decisions implement the supplied V5 master brief and do not certify
external pilot readiness before its hard gates have evidence.

## V5-ADR-001 — Global identity and local presence

Accepted. `agent_identities` owns stable persona metadata. `agents` remains the
company-local execution principal. Company-qualified foreign keys prevent
cross-identity and cross-company runtime associations. Global identity never
appears as an authorization grant. Legacy rows receive identities in bounded
batches before the non-null cutover.

## V5-ADR-002 — One home organization

Accepted. The home owns persona administration and the initial presence. A home
cannot disappear while active guests survive without an explicit rehome or
archive. Identity locks serialize lifecycle changes; local guest termination
remains independent. Global pause/archive cancels every affected presence after
commit, and archive revokes local keys.

## V5-ADR-003 — Explicit execution scope

Accepted. An operator requests a bounded primary/delegated scope. A request is
bound to one operator, task, local agent and run with an expiry. Every scope
resolves the same logical identity's existing local presence and intersects the
represented human's current membership and grants. Read/contribute/act are
checked again at action time. Context retains source company, classification,
sharing restrictions and persisted provenance; no home-memory copy is implied.

## V5-ADR-004 — Provider identity, isolation and qualification

Accepted. Logical identity, physical provider binding and local profile/session
are separate. The local profile/configuration and capability hash are part of
conformance evidence. Provider advertisements alone are unqualified. Shared
state requires each participating company's explicit versioned acknowledgement.
Drift blocks affected dependencies and requires fresh conformance plus explicit
review. An unavailable isolation/cancellation proof fails closed.

## V5-ADR-005 — Company-local organizational units

Accepted. Org Units are bounded acyclic local structures with human/agent
memberships and local leads. Membership describes work and Role Pack overlays;
it does not alter authorization, management grants or reporting-line authority.
Reparent/archive is serialized on the owning company.

## V5-ADR-006 — Accepted company relationships

Accepted. The source proposes and the target accepts. Either side can revoke.
Relationships are descriptive prerequisites, never data access grants. Portfolio
releases add a separate immutable recipient ACL over a frozen snapshot; this
grant never opens the source company's live resources or runtime.

## V5-ADR-007 — Role Packs and progressive disclosure

Accepted. System/company/unit/agent requirements merge deterministically. Only
optional requirements may be removed; conflicting version pins fail. Published
versions are immutable. Availability requirements remain distinct from loading:
task-relevant bodies require matching triggers; always/on-demand are explicit.
The resolver filters current policy and dependencies before descriptor disclosure
and applies real inventory ceilings instead of loading an entire library.

## V5-ADR-008 — Governed Skill lifecycle

Accepted. A draft/challenger is distinct from the active immutable champion.
Private versions are filtered in legacy APIs as well as V5. Positive and negative
controls use the same agent configuration, pinned case set and paired trials.
Safety/process/outcome floors precede cost comparisons; unknown evidence is
inconclusive. Every required suite and retained trace is rechecked at promotion.
Autonomous promotion needs explicit owner/company policy and is prohibited for
high-risk procedures. Overlap and current dependencies remain separate gates.

## V5-ADR-009 — Canonical Playbooks and projections

Accepted. Existing versioned document primitives hold the human procedure.
Unreviewed latest drafts never replace the approved pointer. Proposals pin both
approved and draft bases; a concurrent change makes them stale. A Skill projection
creates a candidate linked to an approved immutable revision. Feedback creates a
canonical change proposal. Neither direction silently activates or approves.

## V5-ADR-010 — Roadmap, forecast and actual events

Accepted. Existing projects/tasks remain canonical. Planned dates are commitments,
forecasts are separately attributed estimates, and actual dates come from events.
Explicit named baselines preserve plan snapshots. Calendar drag/date changes use
optimistic proposals and review. Dependencies are company-local and acyclic.
External field ownership is enforced in both V5 and existing update paths; no
second write master is introduced. Health distinguishes facts from unknowns.

## V5-ADR-011 — Authorization evolution and rollback

Accepted. Reuse the current action/resource authorization service and actual tool
policy; do not add OpenFGA/OPA runtime dependencies. V5 execution forces current
represented-human intersection even after a flag rollback. Typed manifests pin
behavior, never authority. All 20 flags default off with dependency checks in
server and UI. Additive migrations, immutable revisions, provenance and audits
are retained when behavior is disabled. External pilot certification remains
separate from repository verification.
