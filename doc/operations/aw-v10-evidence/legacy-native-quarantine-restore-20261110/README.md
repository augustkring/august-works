# Historical Native provenance after quarantine restore — 2026-11-10

The existing V6 integration performs a real PostgreSQL dump, authenticates the encrypted archive and post-snapshot deletion ledger, and restores into an isolated database. The added case includes one historical protocol-0 Native run with structural input, no source receipt and qualification false.

After restore, the existing tombstone, credential revocation, shared identity rehome and budget-pause checks remain intact. The historical Run still has protocol 0, no receipt and qualification false. The database rejects attempting to adopt protocol 1 with SQLSTATE 23514. The normal restored-database admission guard remains blocked; no synthetic operator release is performed.

R335 passes the single complete case in 33.822 seconds (17.88 seconds test phase), with stable source pins, zero OOM and clean owned PostgreSQL/runtime closure. PostgreSQL archive tools use the existing pinned Docker image `docker.io/library/postgres@sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722`. The harness RSS accounting tracks its descendants, including the Docker client; it does not include daemon-owned container processes.

The earlier r334 stopped after 22.767 seconds at the global memory reserve before reporting a test result. Pulling the pinned image had increased file cache. Read-only cache advice for that image's exact layers restored headroom before r335; resource thresholds and test behavior were unchanged. R334 is inconclusive, not a test failure or pass.

This is scoped V10-169 MIG-05 recovery/restore and MIG-04 reconciliation evidence. MIG-07 concerns authority and responsible review of AI-generated migration proposals. The case does not qualify every read/write/job/outbound path, a production backup or operator release, external deletion completeness or release acceptance. Historical statuses are not promoted.
