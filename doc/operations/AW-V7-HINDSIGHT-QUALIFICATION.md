# Hindsight qualification decision

Date: 2026-10-05. Decision: **KEEP PROVIDER INTERFACE, DEFER HINDSIGHT**.

V7 permits this outcome. The stateless local/no-op provider is available behind the cognitive flag; `hindsight_provider_v7` does not create a Hindsight binding or authorize production use. No Hindsight SDK, runtime dependency or credentials were added.

## Inspected release evidence

Release `v0.10.2`, release tree SHA `5fc4ce20917b916240cef27c212c387a177f115b`. The release license is MIT. Content hashes and source URLs are retained in [the research manifest](aw-v7-evidence/hindsight-spike-2026-10-05.json). These are research observations, not deployment qualification results.

The pinned OpenAPI includes bank-specific retain/recall, document deletion, observation deletion and mental-model refresh/history/clear. It provides useful mapping points for an eventual adapter. AW must retain original Memory IDs/versions and bind every request to a company and binding; provider-generated facts cannot become canonical Memory or Foundation.

The pinned `DefaultTenantExtension` authenticates no requests. Its built-in API-key alternative maps all authenticated requests to one configured schema. An isolated bank identifier is therefore insufficient as the application authorization boundary. A qualified deployment needs a protected service identity, controlled company/binding-to-bank mapping, private-agent separation and no direct customer/provider access path.

Upstream `test_13_delete_document.py` explicitly covers a historical bank-collision deletion bug: the same document ID in two banks must not allow deleting the other bank. `test_delete_document_concurrency.py` covers concurrent document/observation cleanup, rollback, re-ingestion and index cleanup after commit. Reading those tests supports the risk model; it does not establish AW-specific deletion or restore correctness.

## Required adoption evidence

| Gate | Current evidence | Required proof before adoption |
| --- | --- | --- |
| EU topology | Proposed only | Versioned host/service/PostgreSQL-vector topology, region and subprocessors, firewall and protected auth |
| Governed ingestion | AW seam implemented | Accepted source projection mapping, exact IDs/versions, private approval, purpose/sensitivity minimization |
| Isolation | Upstream contract/tests inspected | Two companies with colliding document IDs, two private agents, cross-bank attack cases in the actual deployment |
| Deletion and correction | AW exclusion/outbox implemented | Pending retain vs delete race, derived observation/model erasure, index/cache exclusion and independent receipt |
| Restore and exit | Not run | Preserve AW tombstones across provider restore; rebuild from accepted AW records; complete data removal on exit |
| Performance and cost | Not measured for Hindsight | Representative retain/recall/reflect latency, tail bounds and metered cost compared with the local baseline |
| Recovery and upgrades | Not run | Outage/timeout, bounded retries, conformance drift, pinned image upgrade and rollback without lineage loss |
| Operator readiness | No deployment runbook proof | Credentials in secret system, on-call ownership, incident/export/deletion evidence and operational acceptance |

## Least-complex proposed topology

AW control plane -> protected self-hosted Hindsight service -> EU PostgreSQL with required vector support. Use one company-shared bank per binding and separate company/agent banks for explicitly approved private projections. Do not add Kubernetes solely for this provider. All regional and operational claims remain proposals until observed deployment evidence exists.

Reconsider adoption only after an evaluation demonstrates useful outcome improvement over the local baseline and the gates above pass. No benchmark number or live success is claimed by this document.
