# Native execution input unit verification

The current-source Vitest run `scope-native-execution-input-r2` passed all 23 tests in `server/src/services/native-runtime/native-execution-input.test.ts`. The suite covers Task, attachment, interaction, Context, Role Pack input closure, work-mode framing, external-chat framing, and follow-up context sizing. The new Role Pack test accepts only exact `role_pack_version` inputs and rejects a missing source set, a Task-family source in the Role Pack list, and an unknown family.

Source pins, runner settings, exact raw output and exit codes, syntax/snapshot records, and pinned binary path/hash are preserved. SHA256SUMS covers the archived run files and this README.
