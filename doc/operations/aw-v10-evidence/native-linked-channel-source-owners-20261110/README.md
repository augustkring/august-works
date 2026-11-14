# Linked channel source owners — 2026-11-10

This source checkpoint builds on d6a5f7acb249b817c51607a5ee607ecabeeb8f8f. It remains a draft implementation checkpoint.

The renderer records external channel context as a typed reference. Admission requires one schema-valid wake from the same Run and Task with the same provider. A missing Task, missing or duplicate wake, changed provider or Task, and unrelated unknown reference remain denied. Withdrawal ownership remains separate from provider context, and an unsupported plan reference remains unknown.

The channel delivery owner now passes its already locked linked-Human identity to comment creation. The comment owner rechecks the exact company, endpoint, principal and user link, non-bot principal kind, author and canonical sender metadata in the transaction. It seals a new comment with the existing direct-Human snapshot function. Existing manual HTTP comment rules remain unchanged. Guest and bot input cannot acquire Human source authority; revoked and unrelated-user links remain denied. The existing provider callback discards bot messages before Task creation.

Separate exact source windows:

- r285: all 72 renderer and Native input module tests pass. These tests cover source matching and fail-closed substitutions, without a PostgreSQL or paid model claim.
- r291: one PostgreSQL source-owner regression passes in 26.17 seconds. It exercises linked Task/comment capture, sponsored guest, discarded bot, revoked link and unrelated nonmember scenarios. The added automatic GitHub snapshot assertion belongs to another test and is not claimed by this selected run.
- r292: the actual Slack retry passes its Native runtime, prepared-input, receipt and no-provider-work checks. It then fails at serial Host close. The fixture requires a physical process-stop witness even though its injected handoff failure precedes Runner launch. The retry is not a passing end-to-end case.
- r293: the full server TypeScript check passes in 104.01 seconds against all seven source/test paths in this checkpoint. Source pins stay unchanged and no OOM occurs.
- r284: the prior committed SDK source completes two model turns, then remains retryable after workspace synchronization fails. The relay rejects a download operation absent from its trusted command set. The run fails the required succeeded assertion after 210.82 seconds; it is not an SDK pass.

The source metadata refresh keeps all existing graph owners, original source-base pins, phase cases and migration fields. It refreshes the current issues compatibility pin and six individually reviewed English/Danish Help source pairs. There is no new source-graph path or migration, and no historical requirement status promotion.

The next checks must close the proven prelaunch Host fixture path and validate descriptor-bound workspace download commands. Remaining recovery conversions, browser checks, full CI, production/provider and representative Human qualification are separate. No merge, deployment or complete V10 acceptance is claimed.
