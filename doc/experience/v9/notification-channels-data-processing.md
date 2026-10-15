# Bound account-notification delivery data contract

Contract: `v9.bound-notification-delivery.v1`. Implementation and software
qualification are in progress. This is not live-provider or release acceptance.

The Original notification owner owns the account notice, global timing policy,
company-bound personal destination choice and preference command receipt. The
Original chat owner owns provider-effect admission, credential leases, attempts,
unknown acceptance and provider receipts. A channel preference grants no access,
approves no work and sends no message by itself. No Task, conversation or separate
notification outbox is created to deliver an account notice.

The recipient must be the current verified account and active company member.
Only a currently linked, non-bot principal on the same active Slack/Teams endpoint
and provider account can be selected. A processed Native private-message delivery
proves the person/destination association. Native chat authorization still applies,
including its viewer/guest rules; presentation profiles never grant that access.
The private carrier is independent of the prior Task's lifecycle. Removed identity
or conversation proof clears only its nullable reference and retains the monotonic
preference version as unavailable. Reconnection or a material target/credential
change needs a current explicit review. No email fallback is inferred.

The fields used are account/company/category IDs, Native identity/conversation
references, stable target hash, preference version, explicit notice language,
request ID/body hash, fixed scheduling data and content-free receipt metadata.
Target reads exclude confirmation tokens, communication guidance, task content,
provider raw bodies and credential values. Labels expose only the current own
linked identity and provider-account name. Only bounded current options are shown.

The carrier receives a fixed account-update sentence in explicitly selected
English or Danish and a canonical, allowlisted, same-origin sign-in link. It
receives no task title/content, prompt, document, result, company facts, credential,
chain of thought, arbitrary endpoint, raw callback, browser DOM or screenshot.
The existing provider connection and its commercial/privacy terms remain required;
this change requests no new OAuth scopes, connection grants or permissions.
Mandatory security notices retain their existing delivery owner and cannot be
rerouted or suppressed by this preference. Direct chat replies retain their own
Native interaction owner; this feature does not claim to mute every chat surface.

Unknown preference acknowledgement preserves the same immutable command and
Original receipt lookup. Preference receipts explicitly say no authority, message
or execution was produced. Provider delivery uses the existing single-owner Native
claim, runtime/credential fence and unknown-outcome state. The current own recipient,
policy, Source and destination are checked at admission. An unknown provider effect
is not automatically sent again. A digest records every notice's membership in the
Original grouped effect, including suppression. Reading a notice in app before
admission removes the need for its optional channel interruption.

Command receipt use expires after one day. Its owning purge runs independently of
the channel rollout flag. Source notices keep their existing retention. Staged
optional notices have a maximum three-day delivery purpose window; late, withdrawn
or missing Sources deny transport. Deleting a Source notice cascades its Native
notification effect; losing an action leaves a non-replayable delivery membership.
Account/company erasure cascades the personal configuration and command metadata.
An already admitted external message may have reached its provider; neither local
cleanup nor a preference receipt is proof of physical provider erasure.

Logs contain fixed event/category/channel/version codes only. Do not log destination
IDs, identity labels, notice IDs, payloads, provider error text, headers or URLs.
There is no new telemetry, replay sink or marketing use. Optional channel delivery
is off by default behind `notification_channels_v9`, with the existing notification
policy and transactional-notification prerequisites. Live activation still requires
migration/rollback, retention/restore, endpoint/recipient, provider/host and manual/
representative qualification. Those results must be recorded separately.
