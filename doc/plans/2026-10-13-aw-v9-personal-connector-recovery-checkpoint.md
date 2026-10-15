# V9 personal connector recovery checkpoint

Full V9 and PR #38 remain incomplete. This adds ordinary-member personal
recovery to the already qualified connection-manager projection.

At parent `cf3b28b03457f28ed76666a6e6292b66a3b216fe`, the eight executable paths
have SHA-256 `266dd03b26079acb3d1ff39db0db64cbd2b59e70e97ffd999315ad282e16a351`.
The digest binds sorted paths and exact file bytes separated by null bytes.

The Original fixedPersonalIdentityForReconnect owner now has a content-free
internal read method. It is reused by the V9 reader; there is no new HTTP
credential endpoint or new interpretation of who owns a personal identity.
The native creator remains authoritative, with Original retained-grant
fallback for historical or agent-created rows. The returned review contains
only the fixed current user and the actual grant identity/status/update time.
It contains no credential reference, tenant metadata, token or secret value.

Eligible verified ordinary members can now see only their own per-user
connection findings. Shared/company connections still require the current
Original manager policy. Viewers and instance-admin substitutions remain denied.
An own-looking grant pasted onto another creator's connection cannot transfer
that connection's fixed identity. Revoked/expired/reauthorization status uses
the actual retained personal grant. Current role/personal identity and grant
state bind the Source hash. A restored grant withdraws a stale card after
fan-out. No OAuth state, grant, credential, permission, probe or activity is
created by the reader.

The localized rationale says that this is the user's own connected account.
The card retains navigation only to the exact Original app controls. The
browser models separately exercise member and manager views, without claiming
real hosted OAuth, credential rotation or independent human usability evidence.

Qualification so far: 70 cases pass in six complete files covering migrated
connector ownership, Original AI credential behavior, Original connection
visibility and all three recovery renderers. Exact server/UI types and token gates pass. Both freshly built member/manager
journeys pass English/Danish, keyboard, mobile and Axe checks without mutation.
The executable digest is unchanged through final qualification.
The full V9 scope, complete tests/build/CI and independent review remain open.

Reference guidance: Playbook 06 actual object authority and least privilege;
Playbook 05 negative ownership/revocation tests; privacy minimization; UX clear
ownership and recovery with the existing native controls.
