# V9 approved preference Memory checkpoint

Full V9 remains incomplete. PR #38 stays draft.

The builder can select exact human-approved public/internal company preferences.
Each preference has a bounded lifetime. Private Agent memories and higher-sensitivity
records remain outside this mapping. The selected version, body hash and expiry
participate in the test and published definition. Existing definitions keep their
hashes when the new optional selection field is absent.

Preference use requires current Memory admission, responsible human access,
active Agent membership and an explicit company-read grant. The V5 home-company
read floor remains unchanged. A saved selection grants no access or Memory writes.

Original Context roots are retained before copying a preference into a Native
runtime. Existing erasure guards and cleanup workers close and remove actual
consuming copies. Model debit history remains. Both confirmation dialogs disclose
the selected preference and expiry. Correction and deletion use existing Memory
and Foundation pages.

The Original automatic extraction owner refuses writes from these readonly authored
versions, including retained run identities. A narrow permission change preserves
an existing active owner/admin role atomically without overwriting a concurrent
active-role change. Inactive membership behavior remains unchanged.

## Verification

All 94 actual PostgreSQL cases pass in six suites after the atomic grant repair.
They include access, extraction refusal, selected preferences, representative tests,
publication and physical runtime-copy erasure. All 51 focused shared/UI cases,
server/UI types and token gates pass. All six built EN/DA custom/Hire browser
cases pass with explicit preference and expiry disclosure.

The core frozen digest is
`3e99e426e4eda7eb73eddd4789fe168110a9a3e11710cfd3f38bb64a137b7d27`
on parent `8dfe113fe6a9238240bb87bd3566496aff0151f7`.
The final atomic grant repair, all six PostgreSQL suites and backend types are
qualified at frozen digest `e7fc225d409f160e2f2b06d731b423f43da8cb34c4c8b698fdb86b431e2db589`.
UI code remains identical to the passing UI type and browser phases.
This is software boundary evidence. It does not establish hosted-provider,
deployed sandbox, channel or representative-user acceptance.

## References and remaining work

Brief CUSTOM-07 defines the preference choices and correction/deletion visibility.
Agentic playbook 19 requires Memory provenance, bounded scope and lifetime, and
prevents Memory data from becoming executable authority. Privacy playbook 07
requires dependent-copy and restore protection. Security playbook 06 requires
explicit revocable access. Verification playbook 05 distinguishes actual tests
from fixture qualification metadata.

Runtime provisioning/live staging, broader tools/actions/access/delegation,
maintenance/channel/privacy work, complete screen contracts, full integrated
checks and review remain open. CI browser shard 7/8 also requires reproduction.
