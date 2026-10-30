# Actual conversation known-cost purge attempt R41

The fresh source snapshot and Vite/Oxc syntax preflight passed. The actual route-created Native conversation completed provider usage settlement and local Stop. Canonical purge still failed because the generic FK planner encountered the `role_packs` ↔ `role_pack_versions` published-version pointer cycle; the rollback-only test probe classified it as `company_content_fk_cycle`. This is a failed acceptance attempt, not a green purge result.

The production fix now breaks only this isolated cycle under the current processing company-purge operation by clearing `published_version_id` in the marked purge transaction; the 0552 DELETE-only guard for published Role Pack versions/items remains authoritative.

The selected test executed once (one failed, 30 skipped); exact source pins, logs, binary identity and exits are preserved.
