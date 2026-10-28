# Human workflow coverage migration

The repository's `@paperclipai/db` `generate` workflow completed with exit code 0 under the shared test lock. It generated `0561_equal_supernaut.sql`, `0561_snapshot.json`, and journal entry 0561. The migration safety check and DB TypeScript build inside that workflow passed; see `db-generate.log` and `db-generate.exit`.

The generator's `prune:snapshots` command removed older tracked snapshot files. I restored every tracked snapshot it removed, preserving the existing migration history; the new 0561 snapshot and journal entry remain. The generated SQL adds the coverage receipt table and the nullable `workflow_runs.human_coverage_id` column.
