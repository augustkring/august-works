# CompanyImport 0554 migration budget

The pinned embedded-Postgres cohort passes all four tests: 10,000 representative rows migrate, 10,001 rows are refused before changes, a blocked lock rolls back without advancing the journal, and the same migration succeeds after the blocker is released. The policy applies only to 0554; its historical SQL is unchanged.

`qualification.zip` preserves the exact raw test output, source pins, runner metadata and checksums. `archive.json` records their hashes. The recorded source parser checked 911 files successfully.

This is scoped software evidence. Production population, lock profile, release operator and hosted performance remain unqualified. The Safe Change graph records those boundaries.
