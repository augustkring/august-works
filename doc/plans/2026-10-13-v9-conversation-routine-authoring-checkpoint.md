# V9 conversation routine authoring checkpoint — 2026-10-13

This checkpoint records the implemented routine slice of brief §22. It does not qualify the whole V9 release, production migration, managed runtime, customer pilot or assistive-technology execution.

## Behavior

The actual Tool Gateway exposes `paperclip-self:create_routine_draft` when effective V9 ambient commands are enabled. It uses the Original Routine owner and current company/Agent/run/conversation, verified responsible Human, permissions, generation and source checks. Strict input contains request identity, title, description and priority. No model-supplied execution target, schedule, grants, credentials or responsible-user override is accepted.

Original routines have active/paused/archived statuses. An unconfigured routine draft is **paused with a null execution target**, not a new status. The owner saves the actual first revision and source run. Exact retries, including a later current run in the same conversation generation, return the same routine. Changed intent cannot overwrite that identity. Human changes retain the immutable authored revision and require Original optimistic revision handling.

Conversation reads project at most ten distinct actual saved routines and a separate additional-results flag. They show current title, status, authored/current revision identity, configured-target state and trigger counts. No description, prompt, credentials or execution configuration is copied into this projection. English/Danish cards link to the Original editor and distinguish later Human revisions. Older responses without routine coverage are explicitly unavailable.

Conversational Agent calls to ordinary create/update/restore/manual-run and trigger create/update/delete/secret-rotation cannot substitute an enabled automation for the draft boundary. Ordinary autonomous/legacy behavior remains governed by its original policy. Human configuration and enable remain separate decisions; a saved draft is not execution or qualification evidence.

## Source and erasure

Generated migration 0489 adds the actual company/run revision index and validates reserved conversation provenance against Original run, Agent, responsible Human and conversation identities. Malformed, missing, foreign, retired and recursive routine-execution origins are withheld. Existing direct and bounded Native-task source predicates are preserved.

Routine payload reads and execution recheck the original authoring source. Actual routine execution tasks/runs and Native descendants inherit erasure and current analytical source reader checks, including when an input becomes hidden without an erasure marker. Native and legacy persisted task bindings are covered. These relationships grant no read or execution authority.

The Original transactional Memory erasure owner scrubs routine text, private revision snapshots, linked descriptions, run payloads, Human-authored activity details and copied execution-task bodies, including tasks with no heartbeat yet. Triggers disable schedules; retained IDs remain provenance. Database guards prevent late routine/document/activity writers from restoring erased payloads. Source/account/membership loss during creation rolls back the actual routine and revision.

## Verification

- Actual PostgreSQL routine authoring, Original routine service/routes and schema snapshot drift: **112 cases passed**, four files, exit 0 (`v9-routine-authoring-final-regression`). Includes SDK discovery/invocation, exact retry/fresh-run replay, authority injection rejection, Human revision separation, generation/member withdrawal, late rollback, direct restoration guards, Native/legacy execution closure, no-run execution copies and activity restoration.
- Original analytical-context privacy, Native task ancestry and routine source suite: **84 cases passed**, three files, exit 0 (`v9-routine-authoring-source-complete-tests`). The added regression captures real analytical input, hides it, then verifies routine/task/run withdrawal without deletion markers. Expected unsafe-cache/file fault fixtures remain expected test inputs.
- Prior broader local reproduction of the failing CI server-3 partition: **3,837 cases passed; 12 skipped**, 233 files, exit 0. This preceded the final source-reader/trigger/activity changes and does not explain or qualify the parent CI failure.
- Conversation client/widget: **23 cases passed**, including strict private-field rejection, invalid links/states, English/Danish rendering and older-server coverage. Actual built conversation browser: **one passed**, English/Danish, mobile and axe assertions, no model calls. The browser uses a bounded response fixture; PostgreSQL tests independently exercise the actual saved owner and mutations.
- Final shared and DB builds and UI/server typechecks passed (exit 0). Token, module, migration numbering/safety, coverage and whitespace gates passed. The coverage gate still reports 70 surfaces pending implementation/evidence; it does not qualify the release.

## Reference guidance

The supplied requirements, architecture, construction, verification, security, privacy, agentic AI, frontend, UX and UI playbooks are reference guidance beside the V9 brief. The slice follows company scope, current authority, canonical ownership, explicit Human consequences, negative authority tests, derived-source erasure and accessible status/receipt requirements. In particular the privacy playbook requires derived-data handling after source deletion and reapplication of deletion state before restored data becomes live.

## Remaining full-scope work

Full V9 remains in progress: managed representative transport, broader Custom Agent policy/delegation mappings, other conversation authoring targets, channel adapters and remaining journey/recovery qualification must be closed. Final full repository checks and current-head CI are still required. R0/source-complete and live/pilot/GA evidence remain unqualified.
