# Conversation-model financial owner run, attempt R5

Fresh source snapshot and syntax checks passed. The pinned OpenCode frame suite executed all six selected cases: four passed and two failed during canonical company offboarding. Both failures surfaced the existing `Managed OpenCode data erasure awaits confirmed Native Stop` guard at `runtime-asset-retention.ts:176`; the known-cost case remained at purge/processing and the unknown-hold case remained at retention/processing. This run does not establish either known-cost company purge acceptance or unknown-hold purge denial after runtime erasure.

The four passing cases cover current Human/generation denial, exact-budget boundary, 64th/65th call boundary, and rollback on reservation receipt preemption followed by one actual settlement. No stop receipt or process state was fabricated. The local Native process/runtime cleanup path needs to provide the original confirmed Stop evidence before the two offboarding assertions can complete.
