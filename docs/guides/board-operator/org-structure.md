---
help_article_id: people-and-company-access
title: Company settings, people and enterprise identity
summary: Set company defaults, review operating facts, and manage member and identity access
audience: company-administrators
product_capability_refs: [V10-159]
screen_contract_refs: [SETTINGS-PEOPLE-ACCESS]
owner: augustkring/august-works
maturity: preview
applicable_product_versions: [V10]
locale: en
last_verified_at: 2026-10-30
review_trigger: Company defaults, enterprise identity or operating-fact controls, member, invite, join request, role, status, or reassignment behavior changes
security_or_privacy_sensitive: true
linked_source_files: [ui/src/pages/CompanySettings.tsx, ui/src/components/AccountExperienceLanguageSelect.tsx, ui/src/components/routine-triggers/RoutineTriggers.tsx, ui/src/pages/Enterprise.tsx, server/src/services/enterprise/identity-policy.ts, server/src/services/routines.ts, ui/src/pages/CompanyAccess.tsx, ui/src/components/access/InvitesSection.tsx, ui/src/components/access/CompanySettingsNav.tsx]
---

Open **Company settings → Members** to see the people who can access the selected company. Your available controls depend on your current company role and on which settings the instance administrator exposes.

## Invite or review a join request

Open the **Invites** tab to create or manage an invite when it is available to you. Invited people use the invite link to join; the link’s allowed join types and default role are shown in the invite settings. Some instances provide a separate hosting-platform invite link.

If a join request needs approval, review it in Members before approving or rejecting it. An invitation or join request is not the same as active company access.

## Change a member’s access

Use a member’s edit action to update the role or status offered by the page. Check the displayed role and status before saving. A suspended or removed member may lose access to company content and actions.

For a security concern, use **Suspend for security** when you have permission to manage members. Choose a reason and confirm the suspension from your recently authenticated account. This suspends access to this company, revokes related grants and temporary coverage, and pauses affected work. It can suspend the last active owner; it does not select a replacement. Review the recovery notice before trying to resume work. Other company memberships remain separate. An external action already sent may still need reconciliation.

Before removing a member, review the reassignment choices and the **Responsibility and credential preflight** when available. The preflight lists only items you can currently access and does not establish that the review is complete. Resolve reassignment and credential follow-up through each item’s own controls; choose how to handle assigned tasks and owned routines before confirming removal. An unavailable or incomplete preflight does not prevent removal or security suspension. Verify the resulting owners, credentials and statuses after the change.

Company membership is separate from a Co-worker’s place in the team. See [Work with Co-workers](/guides/board-operator/managing-agents) for worker status and [Export and deletion](/help/export-and-delete) for account or company removal.

## Temporary workflow coverage

Use **Temporary workflow coverage** in access settings to let another active person start a specific published workflow version for a limited period. Both people keep their own permissions. Review the selected version, Task scope, expiry and reason before saving. Revoke coverage here when it is no longer needed. See [Use Workflows](/help/workflows-preview) for the checks that apply when a run starts.

## Set company defaults

An authorized company owner or administrator can set the company’s default display language and time zone in **Company settings → General**. Your explicit personal language choice takes precedence; the company language is a fallback when you have no personal choice. It does not change another person’s saved preference.

The company time zone is used when a new routine schedule is created without an explicit time zone. A time zone already saved on a schedule, or one explicitly selected for a new schedule, remains in effect. Changing the company default does not rewrite existing schedules.

A currently signed-in company owner or administrator can also choose the company’s **Security contact** and **Support and incident contact** in General. These must be eligible current Human members. Selecting a contact records accountability; it does not grant permissions. If access or the selected company changes while the form is open, wait for the current contact list to load before choosing and saving again.

## Review enterprise identity and operating facts

An active company owner can configure the identity policy in **Company settings → Enterprise**. Saving a policy creates or updates a draft; identity activation still requires separate platform qualification. Review and enter the current processing regions, provider inventory, placement, retention description, contract evidence, and limitations from current company and deployment records. The form does not supply assumed facts. If a value has not been checked, record it as unknown where the field allows it or resolve it before saving. A saved description is not evidence that a provider, region, retention commitment, or dedicated placement has been independently verified.
