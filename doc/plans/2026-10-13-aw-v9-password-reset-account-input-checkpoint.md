# V9 password recovery and account input qualification

Full V9 remains incomplete; this checkpoint does not qualify hosted mail delivery,
production authentication, a human usability study or GA.

The public password recovery page uses English/Danish copy, keyboard submission,
pending states and focused errors/receipts. Request acknowledgement does not
disclose account existence. Unconfirmed failures retain the entered value and
show no raw provider error. Passwords remain local to the form and are cleared
on acknowledgement. A different reset token creates a fresh form owner, so it
cannot inherit a password or a late acknowledgement. Same-turn duplicate
submission and empty/undersized programmatic submission are refused.
Original authentication remains authoritative, including session revocation.

The account browser failure was traced to an input gesture racing intentional
withdrawal of the private frame during a current-account recheck. No input
event reached the removed confirmation field. The browser fixture now retries
only local confirmation entry until its value is present on the current field.
It does not retry deletion, consent, an API call or another consequential action.
The production private-frame withdrawal remains intact. Earlier successful
repetitions did not establish that this fixture race was eliminated.

Verification: 25 focused unit cases in two files pass; UI types and token gates
pass. The built password/account browser suites pass all 15 cases with three
repetitions. They cover English/Danish, narrow-screen overflow/accessibility,
error/retry, token replacement, late acknowledgement and the account deletion
journeys. Authentication responses in the password browser fixtures are
explicitly synthetic; these tests do not send mail or change a real password.
The seventy-surface inventory remains pending and is not release acceptance.
The new feedback request-receipt route is included in the API specification;
all twenty API contract/mounted-route coverage tests pass. The previous remote
serialized-suite failure exposed this missing API mapping and is retained as
failed evidence for the older tree.

Reference: V9 account/recovery and accessibility contracts; construction,
verification, security, privacy, UI and UX playbooks.
