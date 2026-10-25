---
help_article_id: export-and-delete
title: Export data or request deletion
summary: Understand company export, organization deletion, and personal account deletion
audience: company-administrators
product_capability_refs: [V10-116, V10-159]
screen_contract_refs: [SETTINGS-DATA-PRIVACY, SETTINGS-PEOPLE-ACCESS]
owner: augustkring/august-works
maturity: preview
applicable_product_versions: [V10]
locale: en
last_verified_at: 2026-10-25
review_trigger: Export scope, deletion, retention, or private Memory sharing and source access changes
security_or_privacy_sensitive: true
linked_source_files: [ui/src/pages/CompanyExport.tsx, ui/src/pages/SaasDeletion.tsx, ui/src/pages/SaasAccount.tsx, server/src/services/saas/account-deletion.ts, server/src/services/saas/offboarding.ts, server/src/services/saas/company-purge.ts, ui/src/pages/Memory.tsx, server/src/routes/memory.ts, server/src/services/memory/memory-service.ts, server/src/services/memory/memory-privacy.ts]
---

Blentera has separate actions for exporting a company, deleting an organization, and deleting your personal account. Check which data and identity you mean before continuing.

## Export company data

Open **Company settings → Export** to choose the files included in a company package. You can separately include the support cases you can currently view; that archive contains customer-visible history, excludes internal notes and access grants, and cannot restore live cases. Review the export preview and its **Not included in this export** report before downloading. A company export is a portable package, not a copy of every database record or provider-held item. See [Importing and exporting companies](/guides/board-operator/importing-and-exporting) for the current package contents and import recovery guidance.

## Request organization deletion

Open **Company settings → Deletion** to review the organization deletion request. The page asks you to export the organization first, confirm its name, and acknowledge the deletion. Organization deletion stops work and begins the displayed offboarding process. It cannot be undone.

Deletion may remain in a retention state while managed backups reach their deletion date. Financial records and a minimal deletion receipt may be retained where required. Follow the status and stage shown on the deletion page; a submitted request is not proof that final erasure has completed.

## Request personal account deletion

Open **Company settings → Security** to review personal account deletion. The form requires your current password, the text **DELETE MY ACCOUNT**, and acknowledgement that you saved the exports you need. If your account requires additional authentication, confirm the recent factor when asked. If the request is accepted, the account page redirects and provides a deletion receipt when available.

If an earlier request has an unknown result, use the recovery shown on the account page instead of starting a new request. For a privacy question, contact [privacy@blentera.com](mailto:privacy@blentera.com). Do not send your password, recovery code, or API key.


## Review a private Memory share (preview)

Where Memory is enabled, a proposed private share shows the exact content and destination. Review both before choosing **Approve and share**. Only the original owner can approve the share from their current account. Ordinary Memory review does not expand access to private sources.

The private original stays private. Recipients still need current access to the destination and retained sources; sharing Memory does not publish an underlying private Task. A shared copy can become unavailable if its source changes, expires, is withdrawn, or is deleted. A saved result may also lose text it copied from a source when that source is deleted. This does not delete an independent task or document written by a person just because the result is linked to it. Deleting the shared copy does not delete the private original.
