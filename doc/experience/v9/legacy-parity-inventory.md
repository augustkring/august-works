# V9 legacy and canonical surface inventory

Source inspection: 2026-10-10, integrated baseline `674784e29f541da29e948856e233fbd0b00fba66`.
This inventory records callers and required parity work. It does not accept
visual, semantic, accessibility, hosted usage or human evidence.

`useStreamlinedUiEnabled` selects the streamlined shell unless the native
instance explicitly sets `enableStreamlinedUi=false`. Missing settings, loading
and failed reads retain the streamlined shell. `App.tsx` still mounts
`Layout.production` for the explicit alternative and retains actual legacy page
imports. The `.production` suffix is not evidence that a file is unused.

The source contains 23 paired `.production.tsx` files. Every corresponding
unsuffixed file exists and every pair differs byte for byte. Some legacy files
also have direct test or Storybook callers. None can be retired on filename or
visual resemblance alone.

| Source family | Current default and retained caller | Parity required before retirement |
| --- | --- | --- |
| Shell and sidebar | `App.tsx` chooses current `Layout` or `Layout.production`; the latter imports its own sidebar, settings/app/contextual sidebars, breadcrumbs and account controls | Exact profile/tenant admission, keyboard/focus, narrow layout, contextual panels, persistent preferences and deep links in both settings |
| Agents roster | `/agents/:filter` selects current `Agents` or lazy `Agents.production`; shared filter names remain route owners | Filters, built-in agent controls, identity/environment warnings, current resource scope and authoritative create/configure behavior |
| Agent detail | Ordinary agent detail routes mount `AgentDetail`; `AgentDetail.production` still has direct log-visibility and UI-contract test references | Source/run/log visibility, Native configuration, current authorization, private query teardown, keyboard/tab/run deep links; test callers must migrate explicitly |
| Company skills | `/skills/*` selects current or lazy legacy `CompanySkills`; native Skill Studio and governance routes remain separate | Skill CRUD/governance meaning, private source admission and both old/new Studio deep links |
| Organization | `/org` redirects to `/agents/all` in streamlined mode; explicit legacy mode mounts `OrgChart.production`; `/org-units` retains its separate Native V5 gate | Reporting/organization editing meaning and authorization, redirects, keyboard tree alternatives and all canonical callers |
| Routines | `/routines`, `/routines/:routineId` and section routes select current or legacy pages; legacy detail imports its own editable sections, and Storybook directly imports those sections | Schedule/timezone behavior, triggers, pause/resume and current revision/read/run admission, section deep links, drag alternatives and source-bound recovery |
| Activity and costs | Current mode uses `AuditHub` and compatibility redirects; legacy mode retains `CompanyActivity.production` and `Costs.production`; agent legacy detail imports `AuditFeed.production` | Query/search parameters, selected agent versus company scope, totals/currency/time boundaries, private log visibility, tab/focus and every compatibility redirect |
| Onboarding | `OnboardingWizardVariant` renders the native local wizard. `OnboardingRoutePage` chooses SaaS onboarding when its real capability is enabled. `SaasWelcomeEntry` retains the V9 activation versus inherited SaaS choice | Authenticated SaaS versus explicit local behavior, original-request recovery, feature rollback, safe provider/package qualification, existing drafts and first-value outcome binding |

The existing `/settings/*`, `/instance/settings/*`, old Skill Studio, organization
and audit/cost aliases already have route owners. Preserve those owner functions
and their query semantics while migrating callers. V9 route deferral changes
loading boundaries; it does not establish semantic parity or authorize deletion.

Paired source files:

| Retained source | Unsuffixed source |
| --- | --- |
| `ui/src/components/AppConnectionSidebar.production.tsx` | `ui/src/components/AppConnectionSidebar.tsx` |
| `ui/src/components/AppsSidebar.production.tsx` | `ui/src/components/AppsSidebar.tsx` |
| `ui/src/components/BreadcrumbBar.production.tsx` | `ui/src/components/BreadcrumbBar.tsx` |
| `ui/src/components/CompanySettingsSidebar.production.tsx` | `ui/src/components/CompanySettingsSidebar.tsx` |
| `ui/src/components/Layout.production.tsx` | `ui/src/components/Layout.tsx` |
| `ui/src/components/SecondarySidebar.production.tsx` | `ui/src/components/SecondarySidebar.tsx` |
| `ui/src/components/Sidebar.production.tsx` | `ui/src/components/Sidebar.tsx` |
| `ui/src/components/SidebarAccountMenu.production.tsx` | `ui/src/components/SidebarAccountMenu.tsx` |
| `ui/src/components/SidebarAgents.production.tsx` | `ui/src/components/SidebarAgents.tsx` |
| `ui/src/components/SidebarCompanyMenu.production.tsx` | `ui/src/components/SidebarCompanyMenu.tsx` |
| `ui/src/components/SidebarNavItem.production.tsx` | `ui/src/components/SidebarNavItem.tsx` |
| `ui/src/components/SidebarShell.production.tsx` | `ui/src/components/SidebarShell.tsx` |
| `ui/src/components/SidebarStarredProjects.production.tsx` | `ui/src/components/SidebarStarredProjects.tsx` |
| `ui/src/components/routine-sections/editable-sections.production.tsx` | `ui/src/components/routine-sections/editable-sections.tsx` |
| `ui/src/pages/AgentDetail.production.tsx` | `ui/src/pages/AgentDetail.tsx` |
| `ui/src/pages/Agents.production.tsx` | `ui/src/pages/Agents.tsx` |
| `ui/src/pages/CompanySkills.production.tsx` | `ui/src/pages/CompanySkills.tsx` |
| `ui/src/pages/Costs.production.tsx` | `ui/src/pages/Costs.tsx` |
| `ui/src/pages/OrgChart.production.tsx` | `ui/src/pages/OrgChart.tsx` |
| `ui/src/pages/RoutineDetail.production.tsx` | `ui/src/pages/RoutineDetail.tsx` |
| `ui/src/pages/Routines.production.tsx` | `ui/src/pages/Routines.tsx` |
| `ui/src/pages/audit/AuditFeed.production.tsx` | `ui/src/pages/audit/AuditFeed.tsx` |
| `ui/src/pages/audit/CompanyActivity.production.tsx` | `ui/src/pages/audit/CompanyActivity.tsx` |


Existing evidence entry points include `Agents.test.tsx`,
`AgentDetail.log-visibility.test.tsx`, `App.activity-routing.test.tsx`,
`SidebarCompanyMenu.test.tsx`, `useStreamlinedUiEnabled.test.tsx`, native
onboarding/sidebar browser suites and Storybook routine/control-plane stories.
Their presence does not establish a passing parity run. V9's current integrated
browser cases cover the new customer paths, not every legacy/default pair.

Before removing an alternative, complete semantic and accessible parity for the
actual owner, prove redirects and query preservation on the exact built artifact,
migrate all source/test/Storybook callers, and observe the relevant usage/support
window. No duration or analytics collection policy is invented here. Keep the
legacy instance preference until its migration criteria are satisfied. Afterward,
remove the obsolete owner and its dead CSS/API branches together. V9 legacy
retirement and the full state matrix remain open.

## Native specialist package owner — 2026-10-14

The retained `/agents/packages` owner is now the navigation destination for
bounded own-installation M0 revalidation cards. Its same-person unsent setup stays
in memory through session checks; changing principal/company remounts it. Only
current session/catalog/options/installations/proposals are rendered, failed or
pending reads hide retained private content, and a selected release is resolved
from the current Original catalog rather than a copied DTO. An old readiness
receipt cannot enable installation after a new authority epoch. Current request
and acknowledgement fences retain explicit local-operator behavior through the
Original Native APIs. Reading current state never replays a mutation. Generic
error copy excludes raw Native/provider prose. The Native Layout owns the sole
main landmark; cancel and the primary action share a mobile footer row, with the
secondary readiness check above. Session recovery restores an existing Agent
control and does not steal a Native dialog's focus.

All package namespaces now use private, no-store responses and the existing
content-free private HTTP log policy, including rejected methods and malformed
scopes. The strict Native integration test and actual logger canary tests cover
those boundaries. Fixed package form copy/status labels now cover EN/DA, including the internal
evaluation and activation boundaries; Original descriptions, warnings and reasons
retain their Source language. The installation unknown-response journey and wider
package component Source closure remain open; this change does
not establish complete legacy parity, live package qualification or retirement.

The Native installation unknown-response journey now retains an original locator
before dispatch, uses exact Original read-back before clearing it and supports
readonly recovery after reload/feature closure. Optional resend is available only
from the original unchanged in-memory request. See ADR-64 and
`doc/operations/aw-v9-package-request-recovery.md` for the separate processing
purpose and supporting Screen Contract. Hosted mixed-version/restore, wider
package component Source closure and the complete legacy state/AT/Human matrix
remain open.


## 2026-10-15 canonical owner follow-up

Agents, CompanySkills and Costs now retain their `.production` import
boundaries as shims over their canonical Native implementations. The classic
Agent tree/mobile list and Skills tabs/rails/Studio remain selectable; current
Agents retains its interactive chart. The shared owners preserve Native reads,
mutations and embedded/standalone Costs variants. This consolidates duplicate
code, not the distinct customer modes or their supported route contract.

See [the implementation and evidence limits](../../plans/2026-10-15-aw-v9-canonical-surface-completion.md).
Final retirement of the classic mode/flag still requires the stated parity,
usage/support window and exact-artifact qualification. Authenticated SaaS and
explicit local onboarding remain distinct, supported workflows.
