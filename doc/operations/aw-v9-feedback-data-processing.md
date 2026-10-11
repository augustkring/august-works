# V9 feedback data processing admission

V9 §85.22 requires Privacy-owned configured references for submission retention,
attachment retention, customer-visible follow-ups, deletion/DSR, incident/legal
holds and aggregate learning retention. The product owner selected configurable
HOUSE periods below. Approval and execution of all six legal/data-processing
policies remain separate requirements; a period does not qualify those owners.

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

Existing account/company deletion ownership is retained. The new image and
retention owners are under construction and must pass current migrated Native,
UI and original feedback/account regression checks before integration. They add
no anonymous learning path or new tenant grant. Required current-policy and
operating proof remains open before GA. Rollback preserves retained feedback and the previously latched local
output-sharing policy; it does not enable Paperclip Labs sharing.

## Owner-selected retention defaults — 2026-10-11

Feedback text and customer-visible follow-ups use 90 days after the case closes.
Selected images use 30 days after upload. An open case reaches review/expiry at
12 calendar months, with a reasoned native operator extension. These are HOUSE
defaults selected for this product, not universal legal retention requirements.

`AW_FEEDBACK_RETENTION_JSON` accepts exactly `closedFeedbackDays`, `imageDays`
and `openFeedbackMonths`. For example:

```json
{"closedFeedbackDays":90,"imageDays":30,"openFeedbackMonths":12}
```

Omitting it loads these frozen defaults. Durations must be positive integers:
days are bounded to 3,650 and months to 120. Malformed, oversized or undeclared
configuration refuses startup without exposing private input. This configuration
does not substitute for the six policy registry references above.

The lifecycle evaluator handles calendar month-end/leap dates, closure dates,
reasoned native case extensions and incident/legal holds. A current or indefinite
hold blocks both case and image eligibility. Case extension does not silently
extend image retention. Follow-ups share the case deadline so no message survives
its original case root. Native hold/extension ownership is implemented below;
its current source still requires complete integration and qualification. No automatic retention deletion job is activated
by this implementation; no customer data was read or deleted to test it.

## Private native controls and explicit account erasure

Only the original configured internal feedback operator with a currently
verified human account can read or change incident/legal holds and case
extensions. Local implicit actors and tenant membership do not grant this
purpose. The owner uses bounded native company/case locks, an exact expected
version, explicit C3 confirmation, a native clock and immutable request receipts.
Reasons remain in private retention tables and the original private operator
view; company activity events include neither case IDs nor reasons. The internal
UI hides private content during owner/session recheck, reviews exact changes
before confirmation and retains one immutable command for explicit unknown-reply
retry. Nothing is automatically resubmitted.

Closure uses the original feedback triage owner and a native database timestamp.
Repeated closure preserves that timestamp; reopening clears it. Historical
closed cases with no original closure timestamp refuse eligibility planning
until native review; creation time is not substituted for missing evidence.

A current hold blocks image removal and case deletion, including direct native
writes. A hold cannot be applied while scanning, storing or deleting is
unconfirmed. The original owner must settle that operation first. An existing
account deletion immediately revokes access and clears named product identity,
but keeps a private DSR link for held content. It remains pending until the
original operator releases the hold (also possible for an archived company),
all allocated image keys are physically confirmed removed and the final native
transaction rechecks remaining links and erasure receipts. A missing provider
acknowledgement never establishes a deleted object or completed account.

The original company offboarding owner also checks current feedback holds before
bulk object erasure. Its native purge preserves exact protected-image deletion
receipts, and completion waits for physical absence confirmation. A new hold
cannot be applied once an approved company purge is pending; an existing hold
can still be released by the original operator. Fulfilled provider PUT and failed
accounting acknowledgements are recorded separately. A rejected provider PUT
acknowledgement remains unknown and never qualifies a second upload or cleanup.

Explicit account and company erasure use their existing workers. No automatic
feedback-retention purge or retention scheduler is activated. Image HTTP intake
remains closed while its full native and UI implementation is being qualified.
The synthetic Unix-socket test daemon validates wire/content ownership; it is
not evidence of deployed antivirus coverage.
