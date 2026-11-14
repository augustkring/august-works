# Official migration generation receipt

The repository-owned `@paperclipai/db` `generate` script completed with exit code `0`; the raw command output is preserved in `db-generate.log`, with `db-generate.exit` recording the status. The package script runs the migration safety check, database TypeScript build, `drizzle-kit generate`, and the repository snapshot-prune command. The tracked migration history snapshots pruned by the generator were restored; the generated 0561 snapshot and journal entry were retained. See `migration-generation.md` for the history-preservation note.

The generated artifacts and their SHA-256 digests are:

| Artifact | SHA-256 |
| --- | --- |
| `packages/db/src/migrations/0561_equal_supernaut.sql` | `c2a75432c25d39c101c3332fab15b6c40610529a95fbb5c3968a8d4b357eafa8` |
| `packages/db/src/migrations/meta/0561_snapshot.json` | `646aca64c50093654144eb1e4ed7964bbe17f6870060205eaede783873cebe1b` |
| `packages/db/src/migrations/meta/_journal.json` | `6d2b7d6084a975a278e55ab86d6bc46de378e4fcaf46f4b9d24b0ae36d2d37d0` |

The journal contains tag `0561_equal_supernaut`. The generator’s pre-run source pins are in `pre-db-generate-source-pins.sha256`. The SQL is generator output, not a hand-authored snapshot or migration chain.
