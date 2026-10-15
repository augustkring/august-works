# Preserve the own notification reset after rollout rollback

A real account-settings gap remained in checkpoint83: after disabling the new
channel rollout and reloading, the outer widget hid the already-saved bound choice.
Email correctly stayed suppressed, but the owner could not explicitly reset that
choice through the UI. A new DOM test reproduces the missing reset before the fix.

Allow only the current own preference read when the existing transactional-notice
capability is effective; the new channel flag continues to gate destinations and
outbound admission. A default preference stays hidden while that flag is off.
Retain the scope after its first admitted preference read, including when the new
flag is already off, so a flag/session recheck does not discard an uncertain reset.
Keep exact Original request/receipt handling and the explicit default choice.
Unavailable is not automatically default, and an initially unavailable destination
must not display a fabricated changed-source warning.

Final 31 UI/API cases pass, including default-off absence of new destination
controls, reload/reset, same uncertain reset through revalidation, actor isolation,
Original replay and source withdrawal. Eleven actual PostgreSQL owner cases pass,
including disabled-rollout view and explicit reset with no message/authority.
The first isolated Native attempt lacked built plugin-SDK dependencies and ran no
cases; local prerequisites were built, then the complete eleven-case suite passed.
The actual built browser passes lost-ack retry, 320px and both-theme WCAG checks,
reload with rollout off, explicit reset, saved-version feedback and another reload
with no additional command or Native work. Two initial browser attempts retained
strict-locator failures; the unavailable-state warning itself was corrected and
the final selector names the specific status message. UI types passed before that
last small warning-condition correction; renew them and token/source gates.

No migration, provider adapter, Native authorization, email fallback or delivery
flag behavior changed. The new workspace owns its project module links; no stale
absolute source links remain. Existing runner dist is reused only from the byte-
identical runner source while local shared/plugin SDK build prerequisites are
built. Final aggregate verification remains pending across explicitly recorded
source checkpoints. No PR/push, real provider send or release claim. R0 and all 70
release evidence gaps remain open.
