# Native wake, Context, cancellation and attachment contracts — 2026-11-10

This is an implementation checkpoint against V10 rev4.0. It does not establish complete V10 acceptance or an all-green CI run.

Native wake capture now binds the channel provider and canonical initial communication guidance to the exact Task wake. Consumption checks the guidance hash. A linked, non-bot channel Human can create the initial Task source snapshot in the same transaction. The locked linked identity stays separate from GitHub sponsorship attribution; automatic and manual GitHub events do not use this direct-Human path.

An empty Context packet uses one canonical renderer and can mint a source-free witness only for those exact bytes, the exact manifest, Run, Agent and Human. Arbitrary text and substituted identities remain denied. Nonempty Context still requires its selected source snapshots.

Migration 0575 extends the existing current-attachment matcher with optional remote staging receipts and the matching stage-hash formula. It preserves the legacy nine-key shape. New receipts use exact keys, bounded counts, unique attachment identities and nonces, integral sizes and current delivered source captures. The database uses its existing integer size ceiling; the staging owner enforces the deployment's configured upload limit. Historical migration 0545 is unchanged.

Failure settlement cannot overwrite a cancelled or other completed Run. Ordinary attachment failure cleanup runs before settlement removes its active Run/lease authority; integrity and ownership failures retain the existing fallback and incident paths. Workflow replay waits for the current Run row under the existing statement timeout instead of treating lock contention as source revocation. The CI security job receives the existing root-owned Node prerequisite without weakening the erasure guard.

Exact, separate source windows are retained below. Counts overlap and must not be added:

- r251: all 22 workflow route tests pass.
- r259: the actual Native Text HTTP cancellation case and hidden-Task recovery case both pass. Unknown charge liability and cancellation survive final settlement. This is not a full 30-case controller pass.
- r264: all 100 signoff/comment route tests pass, including request changes and resubmission. These route tests use a mocked transaction; they do not prove PostgreSQL decision persistence or paid execution.
- r267: all 66 Native input, remote-stage and verified-file module tests pass, including exact empty Context witness rejection cases.
- r273: all 11 low-trust route tests pass with actual PostgreSQL quarantine, authorization and source projection owners. The source projection fixture does not claim model dispatch.
- r280: the full server TypeScript check passes in 99.40 seconds after temporary diagnostics are removed. The subsequent size-bound adjustment changes only SQL and one test numeric literal; the stored pins identify the precise checked source.
- r282: the standalone SQL attachment matcher regression passes against PostgreSQL, including the configured-size-compatible database bound. It proves source/receipt validation without a model dispatch claim.
- r279: the actual Slack retry source now has a Context snapshot and witness, but the next renderer/source consumer rejects an unknown rendered reference before Native admission. This retry test remains failed.
- r274: the SDK integration reaches the later dispatch path, but its harness stops at the aggregate 4 GiB RSS cap after 146 seconds. There is no completed assertion result or OOM. Owned PostgreSQL and runtime descendants are cleaned. This is inconclusive and still requires a complete SDK rerun.

Earlier provider-artifact command 126 was an expected missing-cache probe followed by preinstalled-pack discovery. It did not justify a local Node permission change. The CI root-Node prerequisite is a separate setup requirement.

The source graph adds the new renderer and migration to their existing owners. Its source-base comparisons and all 169 historical requirement assessments remain unchanged. The phase inventory now contains 574 ordered migrations and 74 affected migrations in the existing 12 groups. Remaining channel/recovery fixtures, SDK and browser checks, full CI, production Host/provider, rollback/restore, operator and representative Human qualification remain open. No merge, deployment, paid provider or completed physical erasure is claimed.
