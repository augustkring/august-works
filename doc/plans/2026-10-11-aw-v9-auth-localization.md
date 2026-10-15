# V9 account entry language continuity — 2026-10-11

Status: implemented; focused/strict UI and built software browser passed.

The original auth page now uses the registered experience locale for configured
account methods, Native email/name/password controls, pending/verification/
deleted-account states, retries and method-specific actions. SaaS registration
uses Create your account and Continue; legacy Paperclip copy remains translated
on the original route. The configured SaaS account page shows the original locale
selector and August Works identity. No unconfigured provider buttons are added.

Language changes preserve the mounted account inputs without submitting them.
Refusal uses fixed localized reasons and focuses the programmatically associated
error summary; arbitrary provider messages are not copied into customer text.
The existing minimum password length is explained in the selected language;
short registration passwords receive its specific message without a Native
request. The existing password-manager autocomplete, paste, explicit submission, Native
registration/SSO/verification, safe next/invite guard and company-cache reset
remain intact. This is a view over the original auth owner, not new identity or
company provisioning, hosted SSO proof or full onboarding qualification.

Checks must cover original auth tests, language/refusal/input continuity, strict
UI types, locale/token/coverage checks and a built form with explicit software
capability/session/refusal answers. Final combined regression and manual
language/accessibility acceptance remain pending.

## Scoped verification completed 2026-10-11

The existing auth/API/locale files passed all 15 cases, strict UI types and
token/coverage gates (`v9-auth-localization-focused-v1`). The actual built auth
browser passed its language/refusal/input-continuity, error-focus, password-
manager, SaaS registration wording, unconfigured-SSO absence, zero additional
commands, narrow reflow and automated main-surface accessibility assertions
(`v9-auth-localization-browser-v1`). Both supervisors matched the same public
Source SHA before/after: `93652b4e9b33eda52e07fc45cb70df01a6595f7c8c3673174a3bc9815503984b`.

Its signed-out session, public capability response and refused credential
request are explicit software fixtures. No hosted registration, live enterprise
SSO, delivered verification email or completed company onboarding is claimed.
Those evidence gates, manual acceptance and full combined regression remain
open; the release Source-complete and acceptance flags remain false/unaccepted.
