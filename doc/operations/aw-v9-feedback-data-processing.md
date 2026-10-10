# V9 feedback data processing admission

V9 §85.22 requires Privacy-owned configured references for submission retention,
attachment retention, customer-visible follow-ups, deletion/DSR, incident/legal
holds and aggregate learning retention. No approved periods or legal rules have
been supplied. The implementation does not invent them.

The server accepts `AW_FEEDBACK_DATA_PROCESSING_JSON` as startup-owned JSON:
`schemaVersion` must be 1, `policyVersion` an opaque policy version, `privacyOwner`
a bounded owner reference, and `policies` must include all six keys:
`submissionRetention`, `attachmentRetention`, `followUpRetention`, `deletionDsr`,
`incidentLegalHold` and `aggregateLearningRetention`. Policy references contain
lowercase letters, numbers, dots, underscores or hyphens, beginning with a letter.
They are references to the approved policy registry, not numeric retention days.
The whole document is bounded to 16 KiB; unknown fields, malformed/partial input
and numeric periods refuse startup without logging the private input.

Omit the document while Privacy decisions are pending. Declared references are
frozen for the running server. An operator changes the deployment configuration
and restarts it; neither tenant administrators, customer submissions, triage
agents nor prompts can set these values. Declaration does not establish approval
or implement the policy's native behavior.

`AW_CUSTOMER_FEEDBACK_CHANNEL` defaults to `preview`. An unknown value refuses
startup. `ga` refuses startup when keys are missing and also refuses when keys
are present: native retention/DSR/legal-hold behavior, protected attachment
storage/scanning and exact-artifact release evidence remain unqualified. Never
use `preview` to claim a GA launch. The V9 release coverage gate remains closed.

The existing public policy endpoint returns only fixed contacts, closed attachment
admission, `owner_decision_required` or `configured_execution_unqualified`, and
`ga.allowed=false`, with private/no-store caching. It never returns owner identity,
policy references, retention periods or private parser errors. The supplied
contacts remain privacy@blentera.com, security@blentera.com and
support@blentera.com. No email is sent by this admission path.

Existing account/company deletion ownership is retained. This change adds no
purge job, legal hold, anonymous learning path, attachment upload or new grant.
Those native behaviors require separate implementation and current-policy proof
before GA. Rollback preserves retained feedback and the previously latched local
output-sharing policy; it does not enable Paperclip Labs sharing.
