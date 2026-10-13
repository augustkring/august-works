# Conversation notification preference proposals — 2026-10-13

## Behavior

The current conversation Agent can save a typed notification preference proposal for its verified responsible user. Saving and replaying the exact request never writes an account preference or sends mail. The current user reviews the actual saved proposal and explicitly applies it through the existing account preference owner, using the proposal version and the freshly observed account/category baseline. Preferences apply across companies, which the EN/DA review states before confirmation. Mandatory security delivery cannot be proposed away.

The SDK tool, Human HTTP owner, conversation references and review UI share this canonical saved proposal. A changed baseline requires a fresh review. An exact confirmation replay reads the same receipt. An unknown browser response only permits a current read, never automatic resubmission. Current verified account, company membership, Agent admission, conversation generation, Source readability and current policy are checked at the relevant owners. Final checks roll back late authority or Source loss together with the actual preference write.

## Privacy and provenance

Migration 0492 retains immutable company, user, creator Agent, source run, conversation, generation, category and request provenance. Actual Source loss physically clears the proposal through the existing Memory erasure owner. Late writes and deleted-ID restores cannot bring its preference payload back. Source erasure does not undo a preference explicitly applied by the Human. The existing account deletion owner deletes this user's saved proposals. Human review/apply routes use no-store responses and content-free HTTP logging, including rejected methods. Conversation references contain no preference body, baseline, responsible-user identifier or source-run identifier.

## Reference guidelines

The supplied requirements, API/distributed systems, verification, security, privacy, UX and UI playbooks inform this implementation. Their applicable guidance is reflected in typed synchronized contracts, Original owner reuse, current authority checks, bounded provenance, concurrency and late-writer tests, erasure/restore closure, explicit consequence review and honest evidence claims. They are references beside the V9 brief, not separate user requests.

## Validation observed

- Final five server suites: 109 cases passed, including actual PostgreSQL proposal/confirmation, SDK discovery/invoke, bounded conversation references, concurrent exact confirmations, manual baseline changes, current account/generation, late membership and Source rollback, physical Source purge, immutable provenance, deleted-ID restore, mandatory security delivery, Original notification delivery and private HTTP logging.
- Three UI suites: 17 cases passed, including complete EN/DA preference review, one explicit baseline confirmation, unknown acceptance with read-only refresh, and immediate Source/account concealment.
- Shared/DB builds, migration safety, UI/server types and token/module/coverage/diff gates passed. Original account deletion (six cases), schema drift (one case), and the focused HTTPS backfill runtime fixture (one selected case; 160 skipped) passed. The built browser conversation case passed with explicit notification proposal review in EN/DA, mobile overflow and axe checks. Browser owner responses are controlled fixtures; actual SDK/provenance/confirmation behavior is covered by PostgreSQL tests.

The published parent CI exposed a separate fixture failure: the HTTPS backfill test probed only its backend port while its child also binds a companion port 10,000 higher. The fixture now checks both before choosing its candidate and cleans its probe listeners. Production allocation and ownership checks are unchanged; the focused case passed. This reduces the demonstrated fixture collision; it is not proof that all runtime tests or the current CI have passed.

These are bounded software checks. They do not establish live provider delivery, human pilot completion, full V9 Source completion or GA qualification. The PR remains a draft while the remaining V9 requirements and current complete repository checks are unfinished.
