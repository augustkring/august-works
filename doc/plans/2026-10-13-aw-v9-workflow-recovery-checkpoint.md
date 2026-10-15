# V9 workflow recovery and feedback opening checkpoint

Full V9 and PR #38 remain incomplete. Provisioning, staged live runtime changes,
broader capability mappings, remaining maintenance and release qualification
still need implementation and verification.

At parent `8e2c21f5b0a38750f7edd52fa14947b94d4f3779`, the eleven changed executable
paths have SHA-256 `00403cb6b04b5da9b02449a8c9ddc33480e20826121631d6c5ca8dc20f93e09c`.
The digest binds sorted paths and exact file bytes separated by null bytes.

The Experience reader now projects current owned failed/recovering workflow
runs and runs with an active Original human-interaction wait. Ordinary machine,
delay and external waits do not create a human recovery finding. Archived
workflows are omitted. Cards distinguish test and live runs and link directly
to the existing run view. They cannot retry, cancel, resume or resolve a wait.

Admission requires a verified native account, active membership, current
Original workflows:read and current rollout dependencies, without an
instance-admin bypass. The Original retained-revision and copied-payload
analytical Source owners remain in the read path. The pagination row uses the
same Source checks. No raw name, payload, error, credential or resolution body
is returned. Reads have bounded SQL/deadline budgets; current run, workflow and
human-wait identities bind the Source version. A second native read after
fan-out withdraws stale findings or lost authority.

English/Danish cards use fixed localized evidence, with a generic fallback for
unknown evidence. Built customer projection checks cover keyboard navigation,
mobile layout and Axe. The browser fixture is explicitly a software projection;
actual identity, state and admission run against migrated PostgreSQL. It is not
proof of a deployed repair or independent human usability qualification.

The public feedback opening button stays usable during account revalidation,
with aria-busy announcing the pending account check. Private draft/receipt
contents and all writes remain gated by the Original current account Source.
The actual rendered-button test opens the public contacts during a held session
request, verifies that private text is absent and that no write occurs, then
restores the same-account draft only after confirmation. The private-history
browser assertion now targets the unconfirmed-reply alert explicitly, since an
independent image-load alert may also be present.

Qualification: 59 cases in six complete focused native/UI files pass. Seven
exercise the new migrated workflow owner. The original failing CI shard's
seven files pass all 20 cases locally before the public-opening adjustment.
The three focused built browser journeys each pass twice before that adjustment.
All 35 recursive workspace typechecks pass, including the exact server/UI
checks and Native Rust/contract prerequisites. Token gates pass. After the
public-opening change, all three freshly built browser journeys each pass
twice (six cases). The eleven executable paths retain the same digest before
and after final qualification. Full default tests/build remain pending.

The default repository baseline on the parent completed six disjoint general
server partitions successfully. It was deliberately stopped before source
changes. There is no full-suite pass, and those receipts cannot qualify a new
head. Final complete tests/build/CI and independent review remain required.

Reference guidance: Playbook 06 current object authority and least privilege;
Playbook 05 claim-specific regression/negative evidence; UX playbook current,
accessible Source and recovery. These documents guide implementation rather
than authorize independent actions or make field evidence optional.
