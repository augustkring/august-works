# CI1a workspace cleanup proof fixture

The workspace runtime now verifies Git cleanup against a real inspection-minted restoration proof. The positive branch-race test confirms a branch ref moved after guarded worktree removal is preserved. The positive teardown/recorder test uses a real managed worktree, an actual tracked Paperclip instance pointer, and the inspection proof; it checks recorded cleanup actions and removal of the instance and worktree.

The first focused run (r1) exposed that fixture-local `user.name` and `user.email` config is rejected by the reproducible-repository inspector. The next run (r2) passed the race case and exposed that committing the instance pointer after branch creation left the branch unmerged to its upstream, so guarded `git branch -d` correctly refused. The final fixture uses per-command Git identity and commits the pointer in the initial base commit. The current run (r3) passed 2 tests; 163 unrelated tests were skipped by exact title filtering.

Each run includes its source pins, source snapshot/syntax status, binary digest, runner selection, raw compressed Vitest log, and exit status. `r1` and `r2` are diagnostic failures; `r3` is the qualifying positive result.
