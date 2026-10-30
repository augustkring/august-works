# Current continuation and historical chat attachment fixtures

Two original whole files reproduce and correct eight recorded CI failures without changing production authorization, source policy, continuation or publication behavior.

| Attempt | Actual result | Duration |
|---|---|---|
| Continuation r1 | 136 passed, six handoff variants failed | 57.80s |
| Continuation r2 | 142/142 passed, zero skipped, exit 0 | 55.57s |
| Historical attachment r1 | 19 passed, two unnamed attachment reuse cases failed | 22.35s |
| Historical attachment r2 | 21/21 passed, zero skipped, exit 0 | 24.05s |

The handoff fixture had inserted a Task without a responsible Human. The current original heartbeat owner correctly refused assignment dispatch with `responsible_user_unresolved` (422). Its handoff branch now uses the existing current-Human/session/role fixture helper and canonical `issueService.create`, assigning the real responsible Human. Operational status is updated afterward. Existing handoff, foreign Task/owner, mentions, interaction, chat, running-source, exact comment preservation and single-successor assertions remain unchanged. Other legacy/malformed fixture branches retain their original scope.

Historical attachment byte reads already passed. The two reuse cases are material mutations and correctly failed the original platform Skill admission because the fixture run had no responsible Human or current operating-procedure pin. The fixture now uses the existing current-Human membership helper, assigns that same Human to the Task/run and calls the original `preparePlatformSkillAdmission` using actual current contract hashes. It does not insert Skill/admission rows or claim provider qualification. Original membership revocation, asynchronous access recheck, stopped-run, source lineage, exact PNG/text/empty bytes, no-publication, cancellation and inode cleanup assertions all pass unchanged.

Each run used the serialized canonical source snapshot/parse guard and owned-child cleanup helper. Source reconstruction pins, raw logs and exits are retained. Compressed files preserve the exact raw SHA recorded in `source-boundaries.json`. Checked feature fixtures and named original dependencies match their captured bytes; unchanged tracked dependencies are resolved from the recorded source HEAD. No browser, external provider, broad workspace or noisy-neighbor performance qualification is claimed.
