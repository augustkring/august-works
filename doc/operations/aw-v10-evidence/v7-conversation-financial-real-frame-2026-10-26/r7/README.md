# Conversation-model financial owner run, attempt R7

Fresh source snapshot and syntax checks passed. The pinned OpenCode suite executed all six selected cases with the child-reaper wrapper; four passed and two failed in canonical offboarding/runtime erasure. The terminal-run callback executed after `drainActiveRunExecutions()` and before relay/broker teardown, so moving the outbox before fixture teardown did not resolve the erasure failure.

The unknown-hold diagnostic showed a local Stop receipt and a committed/unleased finalization, but used the helper's stale pre-drain Run object for its process-presence fields. History corrected the helper to reread the Run after drain; R8 will capture the current process state. This run does not establish either known-cost purge acceptance or unknown-hold purge denial after runtime erasure.
