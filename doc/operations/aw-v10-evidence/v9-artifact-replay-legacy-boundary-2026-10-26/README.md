# Historical Artifact replay migration check

The focused Vitest run passed 1/1 against the fresh qualification snapshot.
The source pin for `server/src/__tests__/v9-artifact-replay-source-migration.integration.test.ts`
is `32604b3e93c6a287f44068c4b905fbc1f75765c1fba848282cde80fe1f8032e7`.

The fixture migrates only through the historical pre-0497 journal, then seeds
the source Task, heartbeat run, authored Workflow/revision, and observed replay
runs with SQL that uses columns present at that boundary. It does not alter the
historical schema or call current services before applying pending migrations.
The test passes with the actual migration adding/reconciling the replay source
relationship. Raw Vitest output is gzipped; phase exit codes and source pins are
preserved, with hashes in `sha256sums.txt`.
