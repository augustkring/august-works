# Feedback original storage scope continuation — 2026-10-11

Concrete defect: a durable image deletion currently binds only a key. Changing
provider/root/bucket/prefix could DELETE and HEAD the same key in a different
object namespace and falsely complete while the original object survives.

Reuse actual Storage provider constructors to expose a private stable SHA-256
scope ID derived from provider + effective namespace locator. Disk: resolved
root. S3: bucket, region, effective endpoint, prefix and addressing mode. Never
credentials, no public endpoints expose this ID. This binds configured namespace,
not arbitrary disk replacement/DNS reassignment, historical backups or live S3
qualification. Those operating boundaries remain separately documented.

Persist this scope on the Native scanning -> storing reservation BEFORE PUT;
keep immutable after allocation, including unknown-transport receipts. Preserve
it in original parent/account/company deletion outboxes. Unknown legacy scope
remains unknown: no current-config backfill. Existing generic Storage callers
keep working without this capability; protected feedback requires actual scope.

Reads and manual removals require exact original/current scope before any binary
or provider operation. Retention review binds scope in its private source hash
and makes allocated mismatches ineligible. Approved worker scans only known
matching original outboxes; mismatches/unknown remain pending without DELETE,
HEAD or fabricated completion. Native constraints and triggers prevent scope
rebinding and completion with an unknown scope.

Generate migration through original DB workflow; preserve all historical schema
snapshots. Add real-disk Native regressions for wrong root and restored original
namespace, unknown legacy scope, private projection and Native immutable scope.
Retain all unchanged original Native tests/assertions/timeouts. No deployed
customer storage reads or deletes are authorized/required to test this source.

Initial source required the qualification recorded below.

Implementation persists the constructor-owned namespace before PUT, preserves
it through parent/account/company cascade, and refuses mismatched reads/removal/
retention review before provider I/O. Unknown scopes cannot qualify a deletion
worker or be backfilled into immutable allocated rows. Native 0468/0469 were
generated through the original workflow; original pruned snapshots restored.
The known-scope pending outbox index avoids scanning unrelated namespaces.

Original disk HEAD now propagates filesystem errors other than ENOENT; DELETE
acknowledges only removal or ENOENT. Real EACCES/ENOTDIR/EISDIR fixtures check
that absence and deletion are not fabricated. This also protects original
generic disk callers. All original tests/assertions/deadlines remain unchanged.
Five Native cases extend the erasure suite to 18; actual scope-change and restored
original-root cases use owned disk fixtures. S3 constructor checks do no provider
I/O and are configuration identity tests, not live S3 qualification.

Frozen V1 passed all 123 focused cases, token/coverage gates, Shared/DB builds
and server/UI typing. Native failed during import with EACCES on the new public
`storage/object-scope.ts`; no test cases ran and no Native pass is claimed. Only
the two newly authored public Source/test files received group-read permission.
The original failed log and source snapshots remain preserved.

Public image policy now additionally requires known original Storage scope. A
configured scanner cannot make unknown namespace storage available. Its separate
public unavailability reason contains no private locator/key/hash. Native HTTP
coverage verifies refusal before multipart parsing, scanner byte work, provider
work or another native abuse-budget charge. Original image assertions remain.

Frozen V2 passed all 124 focused cases, token/coverage gates, Shared/DB builds
and server/UI typing. Matching before/after public source SHA-256 for these
stages: `25f35a97b29c3a189a6fcc476b43ce2855d49b20bdd41fe7443a67cbcde060e2`,
at HEAD `3fc6a171eff23e695e13f1d83783b2cc57ca3011` plus recorded source.
Native support prerequisites passed, but database setup could not read the new
0600 migration SQL. Its five beforeAll hooks failed; all 85 cases were skipped
by that setup failure. No Native pass is claimed. The two new public migration
SQL files and their generated snapshots now have group-read access, and the
Native prerequisite explicitly reads migration Source before starting tests.
The new HTTP fixture also now reads only its own exact native budget key, not
all earlier fixtures. Runtime backend/UI/schema are unchanged from V2 typing;
V3 runs fresh focused and all five complete Native files for this test-only fix.

Frozen V3 passed all 124 focused cases in 20 complete files, token/coverage
gates and all 85 Native cases in five complete files (18 retention erasure, 30
image, 16 feedback, six account and 15 SaaS-domain cases). Matching before/after
HEAD: `3fc6a171eff23e695e13f1d83783b2cc57ca3011`; public source SHA-256:
`8663a23a766596671642ea38dbae7de07fdad802715d4645351d9291bfbd19a8`. Backend/UI/schema are unchanged
from V2 Shared/DB/server/UI typing; V3 corrected the owned HTTP test budget
query and public Source access only. No original assertion or deadline changed.

Actual disk and PostgreSQL prove scope mismatch refusal, no provider calls on
unknown scope, preserved original pending receipts, restored-root continuation,
Native immutable scope and actual EACCES handling. S3 checks are constructor
configuration identity checks only. An unchanged locator after disk replacement,
bucket restoration or DNS reassignment still needs its original operating owner.
No live S3, deployed scanner/session, unknown-PUT operating recovery, lost-ledger
restore or six-policy Privacy approval is claimed. Automatic expiry selection
remains inactive; no customer data was accessed or deleted.
