# Native channel semantic cards — 2026-10-13

This checkpoint records the first channel adapter slice of V9 Wave 12 / V9-045–046. Full card-family and live-channel qualification remain in progress.

## Actual change

The Original Native interaction owner adds the shared V9 semantic fields to its existing question and confirmation publications when effective `action_cards_v9` is enabled. Fields contain current kind, reason, pending-state consequence, status evidence, exact Native interaction/company/version identity and observation time. The owner uses the existing publication records, opaque callback identities, current-answer policy, modal forms and terminal updates.

The Original renderer compiles title, reason, body, consequence, evidence and actions through the installed Chat SDK. Slack Block Kit and Teams Adaptive Cards therefore use the same semantic order. Plain fallback retains the additional semantic content. Source metadata remains internal and is not printed into provider cards. Terminal updates reflect the actual answered/rejected/cancelled/expired owner state and carry no live actions.

All added text passes through the existing external-publication sanitizer. Strict metadata rejects extra private fields, a different interaction identity, unsafe Source version text and stale/unavailable callback cards. Existing identity, permission, audience, unknown-delivery, replay and settlement controls continue to belong to the Native owners.

## Verification

- **56 cases passed**, four files: actual PostgreSQL Native staging/terminal settlement, Original publication sanitization, installed Slack/Teams rendering and analytical-reader regression (`v9-channel-native-final-regression`, exit 0).
- **99 cases passed**, three files: Original installed SDK adapter behavior, text part handling and Native interaction bridge (`v9-channel-sdk-original-regression`, exit 0).
- New PostgreSQL fixture stages both Slack and Teams publications, then simulates a published provider receipt before testing terminal settlement. It is software evidence, not a real provider send.
- The installed pure `cardToBlockKit` and `cardToAdaptiveCard` functions preserve Danish prompt/action text, semantic order, exact Original callbacks and plain fallback. Canary tests verify reasoning/credential/broadcast removal and reject unsafe or mismatched metadata.
- Shared build and final server typecheck passed (exit 0). Module, coverage and whitespace gates passed. The coverage guard still reports 70 pending surfaces. No provider accounts were contacted and no customer messages were sent.

## Concrete CI failure fixed

On parent `b95ae8c49e42c5179ef088d91e4bee7a87a939d0`, job `115393846143` failed the hidden-population test in `analytical-reader.integration.test.ts`. It returned `empty_denominator` rather than rejecting. The production query correctly uses a half-open `created_at >= from AND created_at < until` window. The fixture used PostgreSQL's microsecond default timestamp and immediately captured a JavaScript millisecond window end. A hidden fixture could fall outside that window.

The fixture now pins its contributing row inside the window and asserts that bound. A separate regression proves that a hidden row exactly at `until` is excluded, whereas a row exactly at `from` requires access rejection and creates no new measurement. Production population and privacy rules are unchanged. The older parent server-3 failure has not been assigned this cause without its logs.

## Remaining scope

Only the existing question/confirmation send and settlement owners are connected in this slice. Approval, permission, workflow and other families still require their complete canonical settlement/recovery mapping. Remote erasure, unknown sends, independent C7 evidence and real Slack/Teams qualification remain unqualified. The full V9 coverage manifest and release gates remain pending.

Reference guidance: the supplied agentic AI, API integration, verification, privacy, UX and UI playbooks inform the typed component boundary, current Native authority, derived-data limits, real-adapter evidence and clear pending/terminal state distinctions. They remain guidance beside the V9 brief.

## Binary Slack and Teams confirmation extension — 2026-10-14

Ordinary binary confirmations now reuse the existing Native action-token owner
on Slack and Teams when effective action_cards_v9 is enabled. A callback must
match its issued message/action/interaction and current linked Human. New hosts
recheck rollout under a shared settings lock inside Native response commit,
alongside existing current endpoint/destination/membership/link authorization.
Disabling rollout does not replay or reverse a committed response; terminal
settlement remains available. Telegram eligibility and settlement are retained.

| Native request | Slack / Teams behavior |
| --- | --- |
| Closed or modal question | Existing Original option/form owner and current answer policy |
| Ordinary binary confirmation | Original one-use accept/reject callbacks under V9 admission |
| Rejection requires reason | Existing full web review |
| Tool action, credential/connection authorization, document review | Existing full web review; binary callbacks are refused |
| Resolved, cancelled or expired request | Original actionless terminal edit/follow-up |

This adds no general approval, permission grant or cross-channel business
projection. Live host/provider, complete card-family, manual accessibility and
representative Human evidence remain pending. Source metadata is kept inside the
publication boundary; only the existing sanitized semantic text and necessary
opaque action/interaction callback identity reach the provider adapter.
