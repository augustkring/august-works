# Runner authority fixture admission regression receipts

Source snapshot `dd496d2e6f567fcec08159e661a0d6dd28ba44a9` passed the two CI-affected fixture groups in the dependency-qualified mirror under the shared PostgreSQL lock:

- `task-creation-backlog.test.ts`: 11 passed. Fixture now has a seeded current Human, matching Task/Run responsibility and a current `preparePlatformSkillAdmission` pin. Replacement Runs get their own matching current Human and pin; all backlog, replay, reset, and rollback assertions remain enabled.
- `external-chat-wait.integration.test.ts`: 14 passed, 128 filtered. The file tool mutation fixture now binds a separate active Human to its current Task/Run and qualifies the run before invoking `PaperclipRunnerToolAuthority`; each expected delivery, forged marker, changed generation, and revoked membership case remains exercised.

No production authorization or admission guard was changed. The receipt includes exact source pins, compressed patch and Vitest logs, per-stage exits and SHA256SUMS.
