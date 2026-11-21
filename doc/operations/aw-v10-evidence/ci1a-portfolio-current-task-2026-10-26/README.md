# Portfolio current Human Task source regression

The focused test verifies a same-company current Human can see a project-linked Task and its canonical Project in the portfolio, then confirms revoking membership in a second company removes that company from the result. The fixture creates a persisted Human session, creates the Project through the canonical Project API fixture, and creates the Task through `issueService` with original Human input/privacy/source authority.

Pinned R3: 1 passed, 2 unrelated tests skipped. The source pins and raw compressed Vitest log are included.
