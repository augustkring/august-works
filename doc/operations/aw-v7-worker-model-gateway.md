# V7 worker model gateway

The private worker consumer exposes `POST /runtime-tools/model/messages` with a
distinct five-minute `worker_model` capability. Its native scope pins the company,
presence, initiating human, heartbeat, plan version, worker attempt and execution
manifest. Ordinary agent keys, board sessions, connection-tool tokens and browser
requests do not authorize this route. Capability issuance is an internal service
operation; there is no customer endpoint that mints arbitrary worker capabilities.

An operator may configure the paired `AW_WORKER_MODEL_PROFILES_PATH` and
`AW_WORKER_MODEL_PROFILES_SHA256`. The absolute, owner-only file contains at most
100 strict profiles, unique by company/presence and profile ID. A profile pins an
installed native provider binding, immutable provider snapshot, configuration,
existing encrypted AI Connection grant, exact Anthropic Messages model/contract,
whole-request byte and input-token ceilings, maximum output tokens, source SHA,
current tariff and protected qualification artifact digest. Price qualification
expires within 24 hours. A worker transport profile does not establish independent
reviewer calibration or physical sandbox qualification.

The request contains only a stable call ID, bounded system/prompt text and output
token ceiling. Model selection, destination, prices, credentials, subscriptions,
managed sessions, tools, attachments, streaming, caching and automatic retries are
not worker choices. The existing server transport performs one fixed HTTPS
Anthropic Messages POST using a native encrypted credential that stays on the
server. A model response is draft output, never Task completion or approval.

Before dispatch, the native reservation ledger atomically debits the conservative
quote under the original plan cap. Duplicate calls cannot resend provider work,
including after an ambiguous response. Current company, presence identity,
initiating membership/permissions, Task ownership/source/topology, native run and
attempt, Memory retention, provider/secret versions, rollout and original deadline
are checked before, during and after the call. Revocation or ambiguity retains the
financial debit and fences the plan through the existing supervision Stop outbox.
Submitting Stop is not physical termination evidence. Prompt, response and secret
are not persisted by this consumer; the ledger retains bounded financial metadata.

Only `internal_draft` C0/C1 plans with an explicit model cap are supported by this
consumer. Managed OpenShell bindings and autonomous CLI/managed-session calls are
rejected. **Capped worker admission remains closed until the actual worker runner
is forced through this boundary.** Configuring profiles or exposing the HTTP route
does not open admission or qualify previously unbounded transports.

Local acceptance covers the real HTTP route, encrypted native grants, migrated
PostgreSQL reservations, concurrent duplicate dispatch, exhausted caps, authority
and source changes during calls, erasure and no replay. Provider responses/pricing
and profile qualification artifacts are private fixtures. No live vendor price,
account, kernel enforcement or integrated customer pilot is established by them.
