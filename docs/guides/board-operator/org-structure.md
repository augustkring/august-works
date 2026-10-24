---
help_article_id: people-and-company-access
title: People and company access
summary: Invite company members, review join requests, and update or remove access
audience: company-administrators
product_capability_refs: [V10-159]
screen_contract_refs: [SETTINGS-PEOPLE-ACCESS]
owner: augustkring/august-works
maturity: preview
applicable_product_versions: [V10]
locale: en
last_verified_at: 2026-10-24
review_trigger: Company member, invite, join request, role, status, or reassignment behavior changes
security_or_privacy_sensitive: true
linked_source_files: [ui/src/pages/CompanyAccess.tsx, ui/src/components/access/InvitesSection.tsx, ui/src/components/access/CompanySettingsNav.tsx]
---

Open **Company settings → Members** to see the people who can access the selected company. Your available controls depend on your current company role and on which settings the instance administrator exposes.

## Invite or review a join request

Open the **Invites** tab to create or manage an invite when it is available to you. Invited people use the invite link to join; the link’s allowed join types and default role are shown in the invite settings. Some instances provide a separate hosting-platform invite link.

If a join request needs approval, review it in Members before approving or rejecting it. An invitation or join request is not the same as active company access.

## Change a member’s access

Use a member’s edit action to update the role or status offered by the page. Check the displayed role and status before saving. A suspended or removed member may lose access to company content and actions.

Before removing a member, review the reassignment choices. The page can identify tasks assigned to them and routines they own; select how to handle those items before confirming removal. Verify the resulting owners and statuses after the change.

Company membership is separate from a Co-worker’s place in the team. See [Work with Co-workers](/guides/board-operator/managing-agents) for worker status and [Export and deletion](/help/export-and-delete) for account or company removal.
