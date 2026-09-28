# Foundation V1 API contract

**Feature flag:** `enableFoundationV1` (default off)  
**Authority:** August Works V4 Implementation Golden Master

## Authorization

- owner/admin: `foundation:read`, `foundation:propose`, `foundation:edit`, `foundation:approve`
- operator/member: read, propose, edit
- viewer: read
- agent: no implicit Foundation permissions; explicit principal grant required
- direct draft editing, review decisions, proposal decisions, and archive are human-only HTTP operations
- agent changes enter through proposals and never directly rewrite canonical company truth

## Endpoints

| Method | Path | Authz | Concurrency | Side effect | Audit |
|---|---|---|---|---|---|
| GET | `/companies/:companyId/foundation` | read | none | read | none |
| POST | `/companies/:companyId/foundation` | human + edit | company/key uniqueness | create draft/revision | `foundation.document_created` |
| GET | `/companies/:companyId/foundation/:id` | read | none | read | none |
| PATCH | `.../:id/draft` | human + edit | `baseRevisionId` | new working revision when content changes | `foundation.draft_updated` |
| GET | `.../:id/revisions` | read | none | read | none |
| POST | `.../:id/submit` | human + edit | `expectedRevisionId` | draft → in_review | `foundation.revision_proposed` |
| POST | `.../:id/approve` | human + approve | `expectedRevisionId` | in_review → approved | `foundation.revision_approved` |
| POST | `.../:id/reject` | human + approve | `expectedRevisionId` | in_review → draft | `foundation.revision_rejected` |
| GET | `.../:id/proposals` | read | none | read | none |
| POST | `.../:id/proposals` | propose | captures base revision | pending proposal only | `foundation.proposal_created` |
| POST | `.../proposals/:proposalId/accept` | human + edit | stored base must still be current | creates new draft revision | `foundation.proposal_accepted` |
| POST | `.../proposals/:proposalId/reject` | human + edit | proposal pending | pending → rejected | `foundation.proposal_rejected` |
| POST | `.../:id/archive` | human + approve | scoped current row | soft archive | `foundation.document_archived` |

## Error contract

Stable codes used by Foundation include `foundation_disabled`, `permission_denied`, `revision_conflict`, and `foundation_invalid_transition`.

A stale proposal is persisted as `superseded` before the API returns `revision_conflict`. The current draft and approved canonical revision remain unchanged.

## Canonical authority

`documents.latest_revision_id` is the working revision. `foundation_documents.approved_revision_id` pins approved canonical content. Approved governance metadata is likewise preserved until a later draft passes the explicit approval transition.
