# Retained Telegram sources, bounded diagnostics and same-Run retries

Telegram historical input now follows exact processed provider migration receipts within the same company and endpoint. The suffix must stay exact. Traversal is bounded to 32 edges, rejects cycles and ambiguous targets, and never trusts mutable resource labels/metadata as lineage. All current task, conversation, message, principal, membership and runtime checks remain in place. The existing original migration/reply journey is preserved.

The controlled API-policy backend now retains the Human release gate across retries of the same Run, uses distinct attempt turn IDs and closes attempts independently. It remains a controlled policy fixture with no model/provider qualification. The initial pipeline interruption that exposed its duplicate-Run exception is still unresolved.

Native frame and Skill diagnostics hash the persisted error-event message even when its payload is absent. The existing payload-message fallback is preserved; unknown text is not logged. The actual OpenCode resumption fixture also checks checkpoint/session identity, one plan binding/revision and one successful plan write, with no second Run in the unchanged variant. Its polling call now passes the numeric timeout to the actual helper signature and returns a boolean. These real SDK cases are not locally qualified by the component checks below.

The CI mirror helper changes only the exact Azure Ubuntu archive hostname to Ubuntu's canonical archive. Hosted runners, Cargo, Chromium --with-deps, scoped AppArmor and the namespace probe are retained. The change addresses observed pre-test DNS failures; the actual new CI install still needs to run.

Verification:

- R557: four focused tests passed: three diagnostic privacy cases and one controlled retry/gate case. No PostgreSQL, external provider or SDK process was observed.
- R558: server typecheck and build passed (123.097s and 121.236s). Hashes and modification times remained unchanged and source modes were restored. This preceded the later linked-Human/negative test strengthening and CI-only helper changes; production Telegram and diagnostic/backend code are unchanged since this check.
- R559: the current Telegram migration test passed against actual embedded PostgreSQL, using the linked Human established before the original message and requireLinkedHuman=true. It covers one/two-hop reads, receipt completion/scope/provider/type, missing edge, suffix, wrong destination, cycle and branch denial. Normal cleanup left zero owned processes.
- Five offline mirror/helper wiring tests passed. The installer fixture copies the script next to a companion stub; it cannot change the machine's apt sources. These are command tests, not host confinement or network proof.

R84's actual GitHub CI build, typecheck/release-registry, V9 coverage and component-browser lanes passed. Its legacy mocked transport recovery cases still fail admission. Full tests/current CI, initial Native startup/pipeline interruption, genuine SDK recovery qualification and the remaining operator/restore/Human acceptance stay open. No requirement, phase or release qualification is promoted. GitHub historical rename lineage still needs its separate durable migration receipt; no aliases are guessed here. PR42 remains draft and unmerged.
