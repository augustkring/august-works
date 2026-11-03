# Customer problem evidence and quality measures

Use the native source record as the authority. Feedback, Support, incidents, usability/accessibility research, activation, and any future effort or outcome sources keep their own permissions, lifecycle, retention, and erasure rules. The shared taxonomy and measurement contract is implemented in `packages/shared/src/customer-success-quality.ts`.

Authorized Feedback detail and Support case detail include a `customerProblemEvidence` projection. It reports the source kind and ID, the source's own category and lifecycle, any recorded impact, existing Issue links visible under current Issue authorization, and `classification: unknown`. For Feedback, `linkCoverage: current_page` means older triage events may contain additional Issue links. `linkCoverage: unavailable` means no link is visible in the current authorized view; it may be absent, private, or otherwise no longer readable. Do not infer a hidden-link count or reason. This projection does not copy case text or grant access to linked work.

Human review may classify a normalized problem in existing Issue/Decision/Learning work. Keep source category, status, customer need, triage reason, and outcome with the originating owner. A complaint remains a complaint throughout the handoff; acknowledge it, retain the need/outcome, investigate, communicate status, resolve or close, and review recurrence. Do not turn a complaint into feature feedback automatically or infer complaint status from text.

Use the shared problem areas for Human review: task completion, activation/first value, reliability/recovery, connections/maintenance, access/security/privacy, support resolution, accessibility, billing/procurement, product outcome, or other. They are analytical labels; they do not replace the source category or lifecycle.

For quality review, show the period, eligible population, denominator, observed coverage, source, and missing/withdrawn/unavailable state for each proxy:

- Activation first-value evidence is an outcome-context proxy for the authorized original onboarding owner. It does not measure satisfaction or Human effort, and its usable-account baseline remains unavailable.
- Optional product feedback is voluntary qualitative evidence. The task/invitation denominator and response rate are unavailable; silence is not a negative or positive rating.
- Support case lifecycle is a service-process proxy. A resolved status is not a satisfaction rating, and support minutes or customer effort are not currently recorded.
- Representative research or task-success evidence may add context only with its study population, task, and coverage denominator under the research owner's existing governance.

No structured customer satisfaction rating or direct customer-effort measure is currently recorded by the application. Keep satisfaction, effort, activation, task success, feedback, and support resolution separate. Do not compute a composite customer-quality score or infer quality from message volume, employee behavior, clicks, or screen time. This operating pack creates no survey, telemetry, collection, storage, or cross-company aggregate.
