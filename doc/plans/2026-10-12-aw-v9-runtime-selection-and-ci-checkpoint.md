# V9 runtime selection and CI checkpoint

Full V9 remains incomplete. PR #38 remains a draft.

The Hire and Custom Agent flows can select this Agent's currently validated
runtime into the candidate. Selection changes local draft fields; the existing
versioned save owner persists them. Hire can save without leaving Safe Test.
An unsaved selection cannot start a test. Failed or pending runtime reads hide
the source details and selection controls. An explicit recheck starts a read,
and the selection callback checks current identity and the actual query source.
This does not implement new runtime provisioning or staged live runtime changes.

Feedback now opens its public contact frame when an immediate account recheck
would otherwise silently discard the opening action. Private text, images and
receipts stay hidden until current source confirmation. The same account's
unsent draft and keyboard focus recover after confirmation. Submission still
uses the current account check and original request; opening starts no write.

Wider CI found a historical built-in Agent marker migration test that rewound
the old journal on a fully migrated schema. Later deferred triggers then refused
index creation. Its disposable fixture now installs the exact pre-index SQL
and journal, seeds duplicates and runs the current migration owner through the
complete schema. Existing cleanup, uniqueness and orphan-revocation assertions
remain, with a new current-journal assertion. Drizzle migration and raw JSON seed
connections are separate. No production migration or trigger is changed.

Activation tests now wait for the reviewed action to render. Operator feedback
tests wait for the exact unknown-triage status rather than an unrelated alert.
The request identity, frozen contents and mutation-count assertions remain.

## Verified Source and limits

- Integrated UI Source `481e4d1295b1952a001cd36fd9109e98217e023f`:
  80 focused cases in six files, UI types and forbidden-token check pass.
  Six built-browser cases pass for Safe Test in English/Danish, account
  withdrawal, feedback and selected-image unknown-response recovery.
- Native/database Source `ca13c4fe2143cfe9297d915346985b540c00411d`:
  23 cases in three files pass under actual PostgreSQL, including all 19 client
  cases. The integrated server, DB, shared and Rust trees remain byte-identical.
- The same Native Source passes 12 built-browser cases across five suites for
  runtime selection, preparation, account changes, publication and instructions.
- Each heavy qualification preserved its captured Git head and Source digest.
  Browser fixtures use disposable accounts and scoped software API responses.
  The earlier browser attempt failed; the corrected test targets the existing
  disabled-test message and the passing run uses an owned workspace temporary
  directory with traces. Those results do not establish live provider evidence.

New remote CI, complete integrated checks, remaining V9 implementation and final
review are still required. This checkpoint is not merge or release acceptance.
