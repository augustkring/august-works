# V9 customer support and recovery runbook

This document describes the implemented support paths and their limits. It is a
source runbook, not a declaration that V9 launch, incident response, hosted
operation or human usability has been accepted. [Source readiness](../../../evals/aw-v9/readiness.json)
remains R0 and the [coverage manifest](coverage.json) keeps launch evidence pending.

## Destinations

The product owner supplied these addresses. The product uses plain mailto links
without prefilled private report content. No report is sent automatically.

| Purpose | Destination | Product path |
| --- | --- | --- |
| Urgent help or exceptional recovery | support@blentera.com | Help/contact support |
| Security report | security@blentera.com | Separate security link in feedback |
| Privacy report or rights request | privacy@blentera.com | Separate privacy link in feedback |
| Product problem or suggestion | Private Customer Feedback | Global Feedback and My feedback |

Product feedback is not the urgent support or incident channel. Response hours,
response objectives, escalation ownership and the secure transfer method for any
exceptional sensitive evidence must be set by the operating team. This runbook
does not invent those commitments or permit raw credentials in ordinary email.

## Check recorded support access

1. Open Company and its Support access entry while signed in as the current
   company owner. The customer history route is `/company/support-access`.
2. Inspect the original approval reference, operator reference, scope and
   approval/expiry/revocation time. The view contains the ten newest records and
   identifies when older history exists.
3. Treat **recorded** as historical approval metadata. The V6 owner rechecks the
   configured operator, current approving-owner membership, requested scope,
   expiry and revocation when an operator uses access. A recorded approval alone
   does not establish current authorization or successful support work.
4. Use **Manage support access** for the separately owned original controls at
   `/company/settings/support`. Only that native owner can approve or revoke.

The customer read creates no permission or audit write. Account/company changes,
permission withdrawal, unavailable source or source rechecking remove retained
private history. A ten-row empty/latest view does not establish that a previous
unconfirmed command had no effect or that no older record exists.

## Approvals, revocation and an unconfirmed response

The original V6 controls require company-owner approval for a configured named
operator, selected scopes and a bounded duration. The current V9 customer history
does not add a new approval mechanism. Ordinary status inspection does not grant
runtime management, restoration or billing authority.

If an approval response is lost, inspect the original native support-session and
activity state through authorized controls. Do not assume the grant failed and
press Approve again merely because a response or a recent-history record is
missing. The original approval API does not yet implement the V9 immutable
request/reconciliation UX. A still-running transaction or older record can make
absence in a limited snapshot inconclusive. Escalate unresolved command state to
the native operating owner; resolve the original transaction/receipt before a
separately reviewed new approval.

Expiry, operator withdrawal and owner-membership withdrawal are checked at use.
Revocation removes future scoped authority; it is not proof that an earlier
runtime/provider action was reversed. Runtime operations and verified backup
restoration keep their existing independent approval and qualification controls.

## Customer-reviewed diagnostic report

On an authorized workflow run, **Review your support report** shows the exact
JSON that an explicit Download action will export. The allowlist contains only
company/workflow/run/revision references, recorded version/status/time/purpose
and bounded trace-status counts. Resource UUIDs remain private report metadata.

The report omits customer text, names, branch names, prompts, logs, raw errors,
actor identities, credentials and stop commands/receipts. Source rechecking
withdraws the open preview. A downloaded snapshot does not remain a current
authorization or business-result proof. **Download requested** describes browser
initiation, not verified local saving, delivery to support or successful recovery.
The customer chooses any subsequent transfer through the operating team's
approved support process.

## Feedback and privacy

Feedback stores customer prose in its private native domain. Its expandable
disclosure describes allow-listed context. Optional diagnostics are currently
disclosed as an empty structured bundle; images are unavailable. Never replace
that limit with a pasted raw log, prompt, screenshot or automatic capture.

A lost submission acknowledgement retains the original frozen request and key.
Retry that same submission rather than editing an unconfirmed request. My
feedback and follow-up access remain bound to the current account/company.
The no-name option removes the product submission's author field but keeps a
separate protected account-access purpose; it is not an anonymity guarantee.

Public feedback GA remains refused. All six Privacy-owned policy references,
their qualified native execution, attachment/scanner protection, retention,
deletion/DSR, legal hold and aggregate-learning acceptance remain required. A
configured email address or declared policy reference does not complete these
requirements.

## Operating acceptance still required

- Assign support/incident/privacy operating owners, response objectives and a
  protected exceptional-evidence transfer procedure.
- Complete immutable V9 support approval/revocation reconciliation, self-service
  recovery and support-assistant behavior through the original native owners.
- Verify representative hosted runtime, actual operators and credential/channel
  boundaries; do not use fixture approvals as live qualification.
- Complete keyboard, screen-reader, zoom, mobile and representative human support
  journeys on the accepted artifact, including unknown outcomes and revocation.
- Keep critical recovery and unresolved source gaps in the implementation ledger;
  do not mark the whole V9 release ready from the current support-read tests.
