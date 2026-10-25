// Generated from the checked Help Center navigation and article frontmatter.
export type CompanySearchHelpArticle = {
  articleId: string; slug: string; title: string; summary: string; body: string; audience: string;
  maturity: "preview" | "ga"; applicableProductVersions: string[]; locale: string; lastVerifiedAt: string;
};
export const COMPANY_SEARCH_HELP_ARTICLES: readonly CompanySearchHelpArticle[] = [
  {
    "articleId": "start-and-first-result",
    "slug": "guides/board-operator/creating-a-company",
    "title": "Start a company and reach your first result",
    "summary": "Follow the guided setup and check the result of your first task",
    "body": "Use the guided setup shown after you sign in to create a company, prepare a Co-worker, and start a first task. Some screens use Agent for Co-worker. The setup saves your progress so you can leave and return to the current step. Before starting work Follow the choices on screen to describe what the company does and what you want help with. When setup asks for an app or AI account, review the account and access shown before connecting it. A connection that appears in a list is not proof that the provider will accept it later; resolve any reconnect or setup notice before relying on it. The guided flow helps prepare one Co-worker and one task. Review the task and the work it may start before selecting its start action. A task can wait for a connection, approval, or another requirement. Starting a task does not promise that its work will succeed or finish by a particular time. Check the result After a run, open the task to review its status, activity, and any result the Co-worker recorded. A completed run and a useful result are different things: read the output and decide whether it meets your need. If the task is still running, blocked, or failed, use the status and next action shown on the task. See Recover interrupted work before starting another attempt when the first outcome is unclear. Pause setup or leave Use the setup navigation to return to an earlier step, or choose the save-and-exit action when it is offered. When first-task setup provides Stop , use it to request that work stop and wait for the result shown on screen. Do not treat a pending stop as confirmation that the run has ended. For access, billing, or deletion questions, see People and company access, Billing and capacity, and Export and deletion.",
    "audience": "new-company-owners",
    "maturity": "preview",
    "applicableProductVersions": [
      "V10"
    ],
    "locale": "en",
    "lastVerifiedAt": "2026-10-24"
  },
  {
    "articleId": "working-with-coworkers",
    "slug": "guides/board-operator/managing-agents",
    "title": "Work with Co-workers",
    "summary": "Add a Co-worker, check its status, and control when it can receive work",
    "body": "Blentera calls the workers in your company Co-workers . Some current screens still use Agent . You can find them in the company’s Agents area and open a Co-worker to review its settings, connection, and recent work. Add or update a Co-worker Use the add action in the Agents area and follow the fields shown for its role, instructions, and AI connection. The available setup depends on the selected connection and your instance. Review who can use a shared connection and which actions require review before saving. A saved credential may need to be reconnected later if its provider expires or revokes access. Open a Co-worker’s detail page to inspect its status and recent task runs. Check the exact error or setup notice shown there; a Co-worker marked ready to receive work is not a guarantee that a particular provider run will succeed. Pause future work Pause a Co-worker when you do not want it to receive new scheduled or assigned work. Pausing a Co-worker and stopping a run already in progress are separate controls. For an active task, open that task and use the current run action shown there. See Review approvals and stop work. When assigning work, review the task’s instructions, owner, and project. The task page is the source for its current status and recorded result; the Co-worker’s status alone does not confirm that a task is complete. For company members and their access, see People and company access. For a task that did not finish, see Recover interrupted work.",
    "audience": "company-administrators",
    "maturity": "preview",
    "applicableProductVersions": [
      "V10"
    ],
    "locale": "en",
    "lastVerifiedAt": "2026-10-24"
  },
  {
    "articleId": "create-and-track-work",
    "slug": "guides/board-operator/managing-tasks",
    "title": "Create and track work",
    "summary": "Make a task, assign an owner, and check its current status",
    "body": "Tasks are the work items in a company. Open Work to find company work you can access, or open a task to review its description, owner, status, comments, and activity. Create a useful task State the outcome you need in the title, then add the context and acceptance details someone needs to do the work. Select a project or parent task when the work belongs with an existing effort. Choose an owner only after checking that person or Co-worker is appropriate for the task. The task page shows its current status. Assignment or a status change does not by itself prove that a Co-worker started work or that the requested result is complete. Read the task’s activity and output before closing it. Follow progress Use the task’s comments and activity to follow updates. If work is blocked, read the reason shown and resolve the dependency if you can. Open the run or recovery details offered on the task to see whether work is still running, waiting, stopped, or failed. If the outcome of a start, retry, or stop is unclear, check the original task before repeating the action. See Recover interrupted work and Review approvals and stop work. If your company has Workflows enabled, see Use Workflows for the separate draft, test, and publish flow.",
    "audience": "company-members",
    "maturity": "preview",
    "applicableProductVersions": [
      "V10"
    ],
    "locale": "en",
    "lastVerifiedAt": "2026-10-24"
  },
  {
    "articleId": "workflows-preview",
    "slug": "help/workflows-preview",
    "title": "Use Workflows",
    "summary": "Review a workflow draft, test it, and publish only when its steps are ready",
    "body": "Workflows are available only when they are enabled for your company and instance. If you do not see Workflows , ask your instance administrator whether the feature is available. Draft, test, and publish Open Workflows to view the workflows you can access. Create or open a draft, then review its steps and the information each step will use. The editor may let you save a draft even when a step is not ready to run. Use the available test and review actions before publishing. Read the result and any blocking issue. A step marked draft-only or unavailable cannot be assumed to run because it appears in an editor. Fix or remove unsupported steps before publishing. Publishing makes a specific reviewed revision available to run. Review the trigger, inputs, actions, and approvals shown in the publish flow. Changes to the draft after publishing do not change the already-published revision; publish the updated draft when it is ready. Review runs Open a workflow’s run history to check its current state and step details. A run can wait for a task, approval, delay, or other supported condition. Use the run’s own recovery or stop action when one is shown. Do not create a duplicate run just because a response was interrupted; first check whether the original run was accepted. This feature is in preview and its available steps depend on the current registry and deployment. For technical details, see the Workflow API reference.",
    "audience": "company-administrators",
    "maturity": "preview",
    "applicableProductVersions": [
      "V10"
    ],
    "locale": "en",
    "lastVerifiedAt": "2026-10-24"
  },
  {
    "articleId": "apps-and-connections",
    "slug": "help/apps-and-connections",
    "title": "Connect or reconnect an app",
    "summary": "Connect an app, review its access, and restore a connection when asked",
    "body": "Open Apps or Company settings → Apps and data to view connections available to your company. The apps, sign-in methods, and controls shown depend on the current deployment. Connect an app Choose the app and follow its connection flow. Before continuing, review the account or workspace being connected, who can use the connection, and the permissions or actions shown on screen. Finish any sign-in or provider consent in the provider’s own page, then return to Blentera and check the connection status. A connection is permission to use the selected account and scope. It does not mean every possible action is enabled. Review the app’s permissions and action settings before asking a Co-worker to use it. Reconnect when access is unavailable If a connection says Reconnect or Reconnect required , open that connection and use its reconnect action. Sign in to the same provider account and review the current access request. Some apps may ask you to replace credentials or choose a workspace again; the details vary by provider. Check the connection status after returning. Do not paste passwords, API keys, or recovery codes into a task or support request. If reconnect is not available or the status remains unclear, contact human support with the app name and the non-secret status shown on screen.",
    "audience": "company-administrators",
    "maturity": "preview",
    "applicableProductVersions": [
      "V10"
    ],
    "locale": "en",
    "lastVerifiedAt": "2026-10-24"
  },
  {
    "articleId": "people-and-company-access",
    "slug": "guides/board-operator/org-structure",
    "title": "People and company access",
    "summary": "Invite company members, review join requests, and update or remove access",
    "body": "Open Company settings → Members to see the people who can access the selected company. Your available controls depend on your current company role and on which settings the instance administrator exposes. Invite or review a join request Open the Invites tab to create or manage an invite when it is available to you. Invited people use the invite link to join; the link’s allowed join types and default role are shown in the invite settings. Some instances provide a separate hosting-platform invite link. If a join request needs approval, review it in Members before approving or rejecting it. An invitation or join request is not the same as active company access. Change a member’s access Use a member’s edit action to update the role or status offered by the page. Check the displayed role and status before saving. A suspended or removed member may lose access to company content and actions. Before removing a member, review the reassignment choices. The page can identify tasks assigned to them and routines they own; select how to handle those items before confirming removal. Verify the resulting owners and statuses after the change. Company membership is separate from a Co-worker’s place in the team. See Work with Co-workers for worker status and Export and deletion for account or company removal.",
    "audience": "company-administrators",
    "maturity": "preview",
    "applicableProductVersions": [
      "V10"
    ],
    "locale": "en",
    "lastVerifiedAt": "2026-10-24"
  },
  {
    "articleId": "company-import-export",
    "slug": "guides/board-operator/importing-and-exporting",
    "title": "Importing & Exporting Companies",
    "summary": "Preview, import, and recover a company package safely",
    "body": "Blentera companies can be exported to portable markdown packages and imported from local directories or GitHub repositories. This lets you share company configurations, duplicate setups, and version-control your agent teams. Package Format Exported packages follow the Agent Companies specification and use a markdown-first structure: my-company/ ├── COMPANY.md # Company metadata ├── agents/ │ ├── ceo/AGENT.md # Agent instructions + frontmatter │ └── cto/AGENT.md ├── projects/ │ └── main/PROJECT.md ├── skills/ │ └── review/SKILL.md ├── tasks/ │ └── onboarding/TASK.md └── .paperclip.yaml # Adapter config, env inputs, routines - COMPANY.md defines company name, description, and metadata. - AGENT.md files contain agent identity, role, and instructions. - SKILL.md files are compatible with the Agent Skills ecosystem. - .paperclip.yaml holds Paperclip-specific config (adapter types, env inputs, budgets) as an optional sidecar. Export & Import in the App Both flows are also available in the web UI as company settings pages: Export and Import appear in the company settings navigation. Cloud-managed instances: when a hosting platform manages the instance, the company is provisioned by the platform and importing is disabled — the Import page and buttons are hidden, and every import API route answers 403 with code: \"cloud managed\" . Export stays available subject to your current access and the export fidelity report. Self-hosted instances keep the full import surface. The Export page lets you pick exactly which files go into the bundle before downloading it. Above the file tree it shows a \"Not included in this export\" panel — the export fidelity report — listing data the bundle will not carry (for example attachments, approvals, cost history, or activity log entries), with blocking issues highlighted. The Import page previews the package, lets you resolve name collisions and adapter assignments, and applies the import. A \"Start imported agents and routines paused\" checkbox (on by default) makes imported agents and routines land paused instead of live. After the import finishes, an \"Activate imported agents and routines\" panel lists everything that was imported paused so you can resume the agents and activate the routines you select — with this option selected, those imported agents and routines stay paused until you activate them. Confirm the reviewed package Preview the package before importing. The app checks the resolved files again before applying the import. If the files changed, open a new preview, review the changes, and confirm again. For GitHub packages, the preview shows the exact source commit. All package files come from that revision. If the branch moves to a different commit, review a new preview even when the files appear unchanged. An incomplete file list or an unavailable revision stops the preview. Packages with unresolved submodules inside the selected directory are not supported; use a package whose files are included directly. Keep Start imported agents and routines paused selected while reviewing a package. An import does not authorize imported credentials or scripts. Review each selected Co-worker and routine before activation. Task and project content currently requires retained source access in its original company. Moving that content to another company requires an authorized publication flow, which this import page does not provide. A new-company package can contain company and Co-worker configuration without those work items. A source-access refusal before import changes begin is a rejected request; it does not mean work items were copied. Recover an interrupted import An accepted import has a saved operation ID. Reloading the page checks that operation instead of submitting the package again. Signing in as another user does not give access to the original user's import receipt. If a new-company import is still running or its result is unknown before a target company is confirmed, its original requester can find the operation in the Import history for a company they can currently access. The entry says New company, result not yet confirmed . It does not identify or prove that a company was created. Once the target is confirmed, the operation appears in that company's history when you have current access. - Running: wait for the saved operation. Do not create a second import. - Complete: open the imported company. Detailed names may no longer be available, while the saved summary still identifies the completed operation where you retain access. - Rejected before import: follow the reason shown. For a changed package, preview the current files before confirming again. - Outcome unknown: some changes may already have been saved. Keep the operation ID and contact your administrator or support. Do not upload the package again to find out whether the first import worked. A server restart preserves the accepted operation. Automatic replay, cancellation of an import already applying changes, and self-service reconciliation of an unknown result are not available in this preview. The full-detail cache is temporary; its loss does not authorize another import. Exporting a Company Export a company into a portable folder: paperclipai company export <company-id --out ./my-export Options Option Description Default -------- ------------- --------- --out <path Output directory (required) — --include <values Comma-separated set: company , agents , projects , issues , tasks , skills company,agents --skills <values Export only specific skill slugs all --projects <values Export only specific project shortnames or IDs all --issues <values Export specific issue identifiers or IDs none --project-issues <values Export issues belonging to specific projects none --expand-referenced-skills Vendor skill file contents instead of keeping upstream references false Examples # Export company with agents and projects paperclipai company export abc123 --out ./backup --include company,agents,projects Export everything including tasks and skills paperclipai company export abc123 --out ./full-export --include company,agents,projects,tasks,skills Export only specific skills paperclipai company export abc123 --out ./skills-only --include skills --skills review,deploy What Gets Exported - Company name, description, and metadata - Agent names, roles, reporting structure, and instructions - Project definitions and workspace config - Task/issue descriptions (when included) - Skill packages (as references or vendored content) - Adapter type and env input declarations in .paperclip.yaml Stored secret values and machine-local paths are omitted. Task and project exports include source identity references needed to validate a restore; those references grant no access. Review the selected content for sensitive information before sharing a package. Importing a Company Import from a local directory, GitHub URL, or GitHub shorthand: # From a local folder paperclipai company import ./my-export From a GitHub URL paperclipai company import https://github.com/org/repo From a GitHub subfolder paperclipai company import https://github.com/org/repo/tree/main/companies/acme From GitHub shorthand paperclipai company import org/repo paperclipai company import org/repo/companies/acme Options Option Description Default -------- ------------- --------- --target <mode new (create a new company) or existing (merge into existing) inferred from context --company-id <id Target company ID for --target existing current context --new-company-name <name Override company name for --target new from package --include <values Comma-separated set: company , agents , projects , issues , tasks , skills auto-detected --agents <list Comma-separated agent slugs to import, or all all --collision <mode How to handle name conflicts: rename , skip , or replace rename --ref <value Git ref for GitHub imports (branch, tag, or commit) default branch --dry-run Preview what would be imported without applying false --yes Skip the interactive confirmation prompt false --json Output result as JSON false Target Modes - new — Creates a fresh company from company and Co-worker configuration. Task and project content requires the source publication flow described above. - existing — Merges the package into an existing company. Use --company-id to specify the target. If --target is not specified, Paperclip infers it: if a --company-id is provided (or one exists in context), it defaults to existing ; otherwise new . Collision Strategies When importing into an existing company, agent or project names may conflict with existing ones: - rename (default) — Appends a suffix to avoid conflicts (e.g., ceo becomes ceo-2 ). - skip — Skips entities that already exist. - replace — Overwrites existing entities. Only available for non-safe imports (not available through the CEO API). Interactive Selection When running interactively (no --yes or --json flags), the import command shows a selection picker before applying. You can choose exactly which agents, projects, skills, and tasks to import using a checkbox interface. Preview Before Applying Always preview first with --dry-run : paperclipai company import org/repo --target existing --company-id abc123 --dry-run The preview shows: - Package contents — How many agents, projects, tasks, and skills are in the source - Import plan — What will be created, renamed, skipped, or replaced - Env inputs — Environment variables that may need values after import - Warnings — Potential issues like missing skills or unresolved references Imported agents always land with timer heartbeats disabled. Assignment/on-demand wake behavior from the package is preserved, but scheduled runs stay off until a board operator re-enables them. Imports can additionally request pauseAutomations (the default in the app's Import page) so imported agents and routines land fully paused. Use the post-import activation panel — or resume the agents and activate the routines individually — when you are ready for them to run. Common Workflows Clone a company template from GitHub: paperclipai company import org/company-templates/engineering-team \\ --target new \\ --new-company-name \"My Engineering Team\" Add agents from a package into your existing company: paperclipai company import ./shared-agents \\ --target existing \\ --company-id abc123 \\ --include agents \\ --collision rename Import a specific branch or tag: paperclipai company import org/repo --ref v2.0.0 --dry-run Non-interactive import (CI/scripts): paperclipai company import ./package \\ --target new \\ --yes \\ --json API Endpoints The CLI commands use these API endpoints under the hood: Action Endpoint -------- ---------- Export company POST /api/companies/{companyId}/export Export fidelity report GET /api/companies/{companyId}/export/fidelity Preview import (existing company) POST /api/companies/{companyId}/imports/preview Apply import (existing company) POST /api/companies/{companyId}/imports/apply Preview import (new company) POST /api/companies/import/preview Apply import (new company) POST /api/companies/import Import apply requests accept pauseAutomations: true to create imported agents and routines in a paused state. CEO agents can also use the safe import routes ( /imports/preview and /imports/apply ) which enforce non-destructive rules: replace is rejected, collisions resolve with rename or skip , and issues are always created as new. GitHub Sources Paperclip supports several GitHub URL formats: - Full URL: https://github.com/org/repo - Subfolder URL: https://github.com/org/repo/tree/main/path/to/company - Shorthand: org/repo - Shorthand with path: org/repo/path/to/company Use --ref to pin to a specific branch, tag, or commit hash when importing from GitHub.",
    "audience": "company-administrators",
    "maturity": "preview",
    "applicableProductVersions": [
      "V10"
    ],
    "locale": "en",
    "lastVerifiedAt": "2026-10-24"
  },
  {
    "articleId": "approvals-and-stop",
    "slug": "guides/board-operator/approvals",
    "title": "Review approvals and stop work",
    "summary": "Inspect a request, record a decision, or stop an active task run",
    "body": "An approval is a request for a decision. Open Approvals to review pending requests you can access, then open a request to read its details and linked work before deciding. Record an approval decision The request page may offer Approve , Reject , or Request revision . Choose based on the request shown. A revision request sends the item back for changes; it does not approve the action. After submitting, check the status shown on the approval page. Some app actions have their own access review in Apps . Review the provider, account, permissions, and action scope shown there. An app connection or an approval for one action does not automatically approve a different action. Pause or stop task work Open the task to find controls for its active run. Depending on the current state, you may see Pause work , Stop and done , or Stop and cancel . Pause controls the active run; marking a task done or cancelled is a separate task outcome. Read each action’s label and current task status before using it. Wait for the task page to show the resulting run and task state. If a stop or decision has an unknown result, refresh the original task or approval and check its status before repeating the action. See Recover interrupted work for the next safe checks.",
    "audience": "company-administrators",
    "maturity": "preview",
    "applicableProductVersions": [
      "V10"
    ],
    "locale": "en",
    "lastVerifiedAt": "2026-10-24"
  },
  {
    "articleId": "export-and-delete",
    "slug": "help/export-and-delete",
    "title": "Export data or request deletion",
    "summary": "Understand company export, organization deletion, and personal account deletion",
    "body": "Blentera has separate actions for exporting a company, deleting an organization, and deleting your personal account. Check which data and identity you mean before continuing. Export company data Open Company settings → Export to choose the files included in a company package. Review the export preview and its Not included in this export report before downloading. A company export is a portable package, not a copy of every database record or provider-held item. See Importing and exporting companies for the current package contents and import recovery guidance. Request organization deletion Open Company settings → Deletion to review the organization deletion request. The page asks you to export the organization first, confirm its name, and acknowledge the deletion. Organization deletion stops work and begins the displayed offboarding process. It cannot be undone. Deletion may remain in a retention state while managed backups reach their deletion date. Financial records and a minimal deletion receipt may be retained where required. Follow the status and stage shown on the deletion page; a submitted request is not proof that final erasure has completed. Request personal account deletion Open Company settings → Security to review personal account deletion. The form requires your current password, the text DELETE MY ACCOUNT , and acknowledgement that you saved the exports you need. If the request is accepted, the account page redirects and provides a deletion receipt when available. If an earlier request has an unknown result, use the recovery shown on the account page instead of starting a new request. For a privacy question, contact privacy@blentera.com. Do not send your password, recovery code, or API key. Review a private Memory share (preview) Where Memory is enabled, a proposed private share shows the exact content and destination. Review both before choosing Approve and share . Only the original owner can approve the share from their current account. Ordinary Memory review does not expand access to private sources. The private original stays private. Recipients still need current access to the destination and retained sources; sharing Memory does not publish an underlying private Task. A shared copy can become unavailable if its source changes, expires, is withdrawn, or is deleted. Deleting the shared copy does not delete the private original.",
    "audience": "company-administrators",
    "maturity": "preview",
    "applicableProductVersions": [
      "V10"
    ],
    "locale": "en",
    "lastVerifiedAt": "2026-10-25"
  },
  {
    "articleId": "billing-and-capacity",
    "slug": "guides/board-operator/costs-and-budgets",
    "title": "Billing and capacity",
    "summary": "Check subscription status, available capacity, usage, and payment options",
    "body": "Open Company settings → Billing to check the current subscription and capacity information for the selected company. Billing may be unavailable in some deployments; the page will say when it is not available. Understand what is billed The billing page separates Blentera’s paid capacity and managed infrastructure from charges billed by your model or runtime provider. Check the provider’s own account for those separate charges. The page shows the current access state, subscription status, available plans, and usage details supported by your deployment. If the page shows Free Core , read the displayed limits and availability there. If it shows grace or read-only access, follow the action shown on the billing page. When access is read-only, the page says you can view and export your work while changes are unavailable. Manage payment or cancel Select Manage payment and subscription to open the payment provider’s portal. Review the current subscription and its terms there. If that subscription offers cancellation in the portal, complete it there and return to Blentera to check the status. A status such as Cancels at the end of this period appears only after the subscription state is reported back. When checkout says the provider has not confirmed the result, do not create another checkout just to check. Follow the billing page’s reconciliation notice or contact human support. The page’s Refresh subscription action is available after a completed, expired, or failed checkout. Account and organization deletion are separate from subscription changes. See Export and deletion before requesting either one.",
    "audience": "company-administrators",
    "maturity": "preview",
    "applicableProductVersions": [
      "V10"
    ],
    "locale": "en",
    "lastVerifiedAt": "2026-10-24"
  },
  {
    "articleId": "recovering-work",
    "slug": "help/recovering-work",
    "title": "Recover interrupted work",
    "summary": "Check a task’s current state and use its available next action safely",
    "body": "When a task stops making progress, open the original task and check its current status, activity, run history, and next-step notice. A failed response from your browser does not always mean the task failed; the server may have accepted the original action. Check before retrying Read the latest run and any blocker or recovery message. Resolve the named connection, approval, owner, or other requirement if you can. Use a retry action only when it is shown for that task and the current state. If there is no retry action, ask the task owner or an administrator to review the run before creating replacement work. If a scheduled retry is shown, use the task’s Retry now action only if you want to bring that existing retry forward. It does not create a separate task. Check the status again after the action completes. If a Co-worker’s update is refused because access to its restricted sources cannot be preserved, the task’s existing content stays in place. Keep the original task and ask its owner or human support to review the refusal before repeating the update. When a stop is pending Keep the task open while a stop action is pending. Wait for the run and task status to update. If the page reports an unknown outcome, refresh the original task and inspect its latest run before sending another instruction or starting replacement work. For help with an unresolved error, contact human support with the task identifier and the non-secret message shown on screen. Do not include credentials or private task information that the recipient cannot access.",
    "audience": "company-members",
    "maturity": "preview",
    "applicableProductVersions": [
      "V10"
    ],
    "locale": "en",
    "lastVerifiedAt": "2026-10-24"
  },
  {
    "articleId": "help-and-human-support",
    "slug": "help/index",
    "title": "Help and human support",
    "summary": "Find guidance, view your cases, or contact a person directly",
    "body": "Open Help in the app to browse guidance, open support cases, or check the configured service status page. You can contact human support directly at support@blentera.com. You do not need to converse with an assistant first. Search product terms inside Help to find matching guidance. Help articles are available in English and Danish. Search uses your current display language. Open a result in a new tab to keep your work and the Help view available. You can also find Help articles in the current command palette. Press Ctrl+K on Windows or Linux, or ⌘K on Mac, and enter a topic. Choosing a Help article opens it in a new tab and returns focus to the control you used to open the palette. The existing Work view stays available. When you open Help from signed-in work in the same company, close it to return to your original view. Do not put passwords, recovery codes, API keys, or other secrets in a support message. Review any diagnostic information before sharing it. Support cases Choose Support cases to send a request or read an existing case. A saved case receipt confirms that the request was stored. It does not by itself confirm delivery to an external support provider or a response time. Follow the processing notice shown before sending; intake may be unavailable when that notice is not configured. If a submission's result is unknown, keep the page's original request and use its recovery action. Reload checks for the saved receipt. Do not create another request solely because the response was interrupted. If a saved case shows unknown delivery, keep its reference and contact support directly. An interrupted delivery attempt is not automatically sent again, because the provider may already have received it. Open a case to read replies from support. Waiting for you shows what support needs from you. Replying to a resolved case reopens the same case. Replying to a closed case creates a linked follow-up and keeps the original history. Report a security or privacy concern Use security@blentera.com for a security concern and privacy@blentera.com for a privacy request. Share only the information needed to explain the concern. Never send a credential to prove that you possess it. Import recovery For a running or interrupted company import, follow Importing and exporting companies. An unknown result needs reconciliation before another import can safely run. Technical documentation The other documentation tabs cover native protocols, self-hosting, adapters, and developer APIs. Technical names such as Paperclip Runner, paperclipai , and .paperclip.yaml identify the underlying components and package formats.",
    "audience": "company-members",
    "maturity": "preview",
    "applicableProductVersions": [
      "V10"
    ],
    "locale": "en",
    "lastVerifiedAt": "2026-10-25"
  },
  {
    "articleId": "preview-and-known-limits",
    "slug": "guides/board-operator/experimental-features",
    "title": "Preview features and known limits",
    "summary": "Understand preview and experimental labels and find the current feature status",
    "body": "Feature availability can differ by deployment and company. A feature marked Preview or Experimental is still changing. The Experimental settings page says experimental features may break; do not make a critical process depend on one unless your team accepts that risk. Check whether a feature is available Look for the feature in the app and read its current label and setup notice. If it is missing, ask your instance administrator whether it is enabled for your deployment. Do not assume that a feature exists because it appears in an API or developer reference. An experimental setting is controlled at the instance level when the control is visible. Ask the instance administrator before changing it. Before disabling a setting related to a running integration, check that feature’s own guidance and current status. Release information and service incidents This Help Center does not currently provide a complete release-by-release feature history. Use the feature’s current screen and its linked guidance for availability and limits. Open Help and human support to ask about a specific product limitation. If Help shows a configured service status page, check it for reported service incidents; it does not describe every feature limitation.",
    "audience": "company-members",
    "maturity": "preview",
    "applicableProductVersions": [
      "V10"
    ],
    "locale": "en",
    "lastVerifiedAt": "2026-10-24"
  },
  {
    "articleId": "developer-and-advanced",
    "slug": "help/developer-and-advanced",
    "title": "Developer and advanced documentation",
    "summary": "Find the API, CLI, deployment, and advanced configuration references",
    "body": "For technical setup and integration details, use the existing documentation references: - API overview, authentication, and API reference - CLI overview and setup commands - Deployment modes, secrets, and environment variables The API and CLI references describe their own supported commands and endpoints. Availability can depend on your deployment, enabled features, and current authorization. Use the documentation for your installed version and review the current screen or API response before repeating a write after an interrupted request. For help with a customer task, use Help and human support instead of placing private data or credentials in a developer log.",
    "audience": "developers-and-instance-administrators",
    "maturity": "preview",
    "applicableProductVersions": [
      "V10"
    ],
    "locale": "en",
    "lastVerifiedAt": "2026-10-24"
  },
  {
    "articleId": "start-and-first-result-da",
    "slug": "da/guides/board-operator/creating-a-company",
    "title": "Opret en virksomhed, og nå dit første resultat",
    "summary": "Følg den guidede opsætning, og gennemgå resultatet af din første opgave",
    "body": "Brug den guidede opsætning, der vises, når du er logget ind, til at oprette en virksomhed, klargøre en Co-worker og starte en første opgave. Nogle skærmbilleder bruger stadig betegnelsen Agent . Opsætningen gemmer dine fremskridt, så du kan vende tilbage til det trin, du var nået til. Før arbejdet begynder Følg valgene på skærmen for at beskrive, hvad virksomheden laver, og hvad du ønsker hjælp til. Når opsætningen beder dig forbinde en app eller AI-konto, skal du kontrollere, hvilken konto og adgang der vises, før du fortsætter. At en forbindelse står på en liste, er ikke en garanti for, at udbyderen senere accepterer den. Løs en besked om genforbindelse eller opsætning, før du regner med forbindelsen. Den guidede proces hjælper dig med at klargøre én Co-worker og én opgave. Gennemgå opgaven og det arbejde, den kan starte, før du vælger start-handlingen. En opgave kan vente på en forbindelse, godkendelse eller et andet krav. At starte en opgave er ingen garanti for, at arbejdet lykkes eller bliver færdigt inden et bestemt tidspunkt. Gennemgå resultatet Efter et kørselsforsøg skal du åbne opgaven og kontrollere dens status, aktivitet og eventuelle registrerede resultat. En afsluttet kørsel og et brugbart resultat er ikke det samme. Læs resultatet, og vurder, om det opfylder dit behov. Hvis opgaven stadig kører, er blokeret eller fejlede, skal du følge status og næste handling på opgaven. Se Genoptag afbrudt arbejde, før du prøver igen, hvis det første resultat er uklart. Sæt opsætningen på pause, eller gå ud Brug navigationen i opsætningen til at gå tilbage, eller vælg handlingen til at gemme og gå ud, hvis den vises. Hvis den første opgave viser Stop , kan du bruge den til at anmode om, at arbejdet stopper. Vent, indtil skærmen viser resultatet. En ventende stopanmodning betyder ikke, at kørslen er afsluttet. Se Personer og virksomhedsadgang, Fakturering og kapacitet og Eksport og sletning, hvis du har spørgsmål om adgang, betaling eller sletning.",
    "audience": "new-company-owners",
    "maturity": "preview",
    "applicableProductVersions": [
      "V10"
    ],
    "locale": "da",
    "lastVerifiedAt": "2026-10-25"
  },
  {
    "articleId": "working-with-coworkers-da",
    "slug": "da/guides/board-operator/managing-agents",
    "title": "Arbejd med Co-workers",
    "summary": "Tilføj en Co-worker, kontrollér dens status, og styr hvornår den kan modtage arbejde",
    "body": "Blentera kalder virksomhedens arbejdere for Co-workers . Nogle af de nuværende skærmbilleder bruger stadig betegnelsen Agent . Find dem under virksomhedens område for agenter, og åbn en Co-worker for at gennemgå dens indstillinger, forbindelse og seneste arbejde. Tilføj eller opdatér en Co-worker Brug tilføj-handlingen i agentområdet, og udfyld felterne for rolle, instruktioner og AI-forbindelse. De tilgængelige indstillinger afhænger af forbindelsen og din instans. Kontrollér, hvem der kan bruge en delt forbindelse, og hvilke handlinger der kræver gennemgang, før du gemmer. En gemt adgang kan senere kræve genforbindelse, hvis udbyderen udløber eller tilbagekalder adgangen. Åbn Co-workerens detaljeside for at se dens status og seneste opgavekørsler. Læs den præcise fejl eller opsætningsbesked. En Co-worker, der er markeret som klar til at modtage arbejde, er ingen garanti for, at en bestemt kørsel hos en udbyder lykkes. Sæt fremtidigt arbejde på pause Sæt en Co-worker på pause, hvis den ikke skal modtage nye planlagte eller tildelte opgaver. At sætte en Co-worker på pause og at stoppe en igangværende kørsel er to forskellige handlinger. Åbn den aktive opgave, og brug den aktuelle kørsels-handling dér. Se Gennemgå godkendelser og stop arbejde. Når du tildeler arbejde, skal du gennemgå opgavens instruktioner, ejer og projekt. Opgavesiden viser dens aktuelle status og registrerede resultat. Co-workerens status alene bekræfter ikke, at opgaven er færdig. Se Personer og virksomhedsadgang for virksomhedens medlemmer og deres adgang. Se Genoptag afbrudt arbejde, hvis en opgave ikke blev færdig.",
    "audience": "company-administrators",
    "maturity": "preview",
    "applicableProductVersions": [
      "V10"
    ],
    "locale": "da",
    "lastVerifiedAt": "2026-10-25"
  },
  {
    "articleId": "create-and-track-work-da",
    "slug": "da/guides/board-operator/managing-tasks",
    "title": "Opret og følg arbejde",
    "summary": "Opret en opgave, vælg en ejer, og kontrollér dens aktuelle status",
    "body": "Opgaver er virksomhedens arbejdsemner. Åbn Work for at finde de opgaver, du har adgang til, eller åbn en opgave for at se beskrivelse, ejer, status, kommentarer og aktivitet. Opret en tydelig opgave Skriv det ønskede resultat i titlen, og tilføj derefter den sammenhæng og de acceptkriterier, som den ansvarlige skal bruge. Vælg et projekt eller en overordnet opgave, hvis arbejdet hører til en eksisterende indsats. Vælg først en ejer, når du har kontrolleret, at personen eller Co-worker er passende til opgaven. Opgavesiden viser den aktuelle status. En tildeling eller statusændring beviser ikke i sig selv, at en Co-worker er begyndt, eller at resultatet er færdigt. Læs opgavens aktivitet og output, før du lukker den. Følg fremskridtet Brug opgavens kommentarer og aktivitet til at følge opdateringer. Hvis arbejdet er blokeret, skal du læse årsagen og løse afhængigheden, hvis du kan. Åbn de kørsels- eller genoprettelsesdetaljer, der vises på opgaven, for at se, om arbejdet stadig kører, venter, er stoppet eller fejlede. Hvis resultatet af en start, et nyt forsøg eller et stop er uklart, skal du kontrollere den oprindelige opgave, før du gentager handlingen. Se Genoptag afbrudt arbejde og Gennemgå godkendelser og stop arbejde. Hvis Workflows er slået til for virksomheden, kan du se Brug Workflows for den separate proces til kladde, test og publicering.",
    "audience": "company-members",
    "maturity": "preview",
    "applicableProductVersions": [
      "V10"
    ],
    "locale": "da",
    "lastVerifiedAt": "2026-10-25"
  },
  {
    "articleId": "workflows-preview-da",
    "slug": "da/help/workflows-preview",
    "title": "Brug Workflows",
    "summary": "Gennemgå et workflowudkast, test det, og publicér først, når trinnene er klar",
    "body": "Workflows er kun tilgængelige, når de er slået til for virksomheden og instansen. Hvis du ikke kan se Workflows , skal du spørge instansadministratoren, om funktionen er tilgængelig. Kladde, test og publicering Åbn Workflows for at se de workflows, du har adgang til. Opret eller åbn en kladde, og gennemgå trinnene samt de oplysninger, hvert trin bruger. Redigeringen kan tillade, at du gemmer en kladde, selv om et trin endnu ikke kan køres. Brug de tilgængelige test- og gennemgangshandlinger før publicering. Læs resultatet og eventuelle blokeringer. Et trin, der kun er til kladdebrug eller ikke er tilgængeligt, bliver ikke automatisk kørselsklart, fordi det vises i redigeringen. Ret eller fjern trin, der ikke understøttes, før du publicerer. Publicering gør en bestemt gennemgået revision klar til kørsel. Kontrollér udløseren, input, handlinger og godkendelser, som vises i publiceringsforløbet. Ændringer i kladden efter publicering ændrer ikke den allerede publicerede revision. Publicér den opdaterede kladde, når den er klar. Gennemgå kørsler Åbn et workflows kørselsoversigt for at se den aktuelle status og trindetaljer. En kørsel kan vente på en opgave, godkendelse, forsinkelse eller anden understøttet betingelse. Brug kun kørsels egen genoprettelses- eller stophandling, når den vises. Opret ikke en dubletkørsel, blot fordi et svar blev afbrudt. Kontrollér først, om den oprindelige kørsel blev accepteret. Funktionen er i forhåndsvisning, og de tilgængelige trin afhænger af det aktuelle register og din installation. Tekniske detaljer findes i den engelske Workflow API-reference.",
    "audience": "company-administrators",
    "maturity": "preview",
    "applicableProductVersions": [
      "V10"
    ],
    "locale": "da",
    "lastVerifiedAt": "2026-10-25"
  },
  {
    "articleId": "apps-and-connections-da",
    "slug": "da/help/apps-and-connections",
    "title": "Tilslut eller genopret en appforbindelse",
    "summary": "Tilslut en app, gennemgå adgangen, og genopret forbindelsen, når du bliver bedt om det",
    "body": "Åbn Apps eller Company settings → Apps and data for at se de forbindelser, virksomheden kan bruge. Apps, loginmetoder og kontroller afhænger af den aktuelle installation. Tilslut en app Vælg appen, og følg forbindelsesforløbet. Før du fortsætter, skal du kontrollere den konto eller arbejdsplads, der tilsluttes, hvem der kan bruge forbindelsen, og hvilke tilladelser eller handlinger der vises. Gennemfør login eller samtykke på udbyderens egen side. Vend derefter tilbage til Blentera og kontrollér forbindelsens status. En forbindelse giver adgang til den valgte konto og det viste omfang. Det betyder ikke, at alle handlinger er slået til. Gennemgå appens tilladelser og handlingsindstillinger, før du beder en Co-worker om at bruge den. Genopret en forbindelse, når adgangen mangler Hvis en forbindelse viser Reconnect eller Reconnect required , skal du åbne den og bruge handlingen til at genoprette forbindelsen. Log ind på den samme udbyderkonto, og gennemgå den aktuelle adgangsanmodning. Nogle apps kan bede dig om at erstatte adgangsoplysninger eller vælge en arbejdsplads igen. Detaljerne varierer mellem udbydere. Kontrollér forbindelsens status, når du vender tilbage. Indsæt ikke adgangskoder, API-nøgler eller gendannelseskoder i en opgave eller supportanmodning. Hvis genforbindelse ikke er tilgængelig, eller status stadig er uklar, kan du kontakte menneskelig support med appens navn og den ikke-hemmelige status, der vises.",
    "audience": "company-administrators",
    "maturity": "preview",
    "applicableProductVersions": [
      "V10"
    ],
    "locale": "da",
    "lastVerifiedAt": "2026-10-25"
  },
  {
    "articleId": "people-and-company-access-da",
    "slug": "da/guides/board-operator/org-structure",
    "title": "Personer og virksomhedsadgang",
    "summary": "Invitér medlemmer, gennemgå anmodninger om adgang, og ændr eller fjern adgang",
    "body": "Åbn Company settings → Members for at se, hvem der har adgang til den valgte virksomhed. De kontroller, du kan bruge, afhænger af din virksomhedsrolle og af, hvilke indstillinger instansadministratoren har gjort tilgængelige. Invitér, eller gennemgå en anmodning om adgang Åbn fanen Invites for at oprette eller administrere en invitation, hvis den er tilgængelig for dig. Inviterede personer bruger invitationslinket til at blive medlem. De tilladte tilmeldingstyper og standardrollen vises i invitationens indstillinger. Nogle instanser har også et særskilt invitationslink fra hostingplatformen. Hvis en anmodning om adgang kræver godkendelse, skal du gennemgå den under Members, før du godkender eller afviser den. En invitation eller anmodning om adgang er ikke det samme som aktiv virksomhedsadgang. Ændr et medlems adgang Brug medlemmets redigeringshandling til at ændre den rolle eller status, siden tilbyder. Kontrollér den viste rolle og status, før du gemmer. Et suspenderet eller fjernet medlem kan miste adgangen til virksomhedens indhold og handlinger. Før du fjerner et medlem, skal du gennemgå valgene for omfordeling. Siden kan vise opgaver, der er tildelt personen, og rutiner, som vedkommende ejer. Vælg, hvad der skal ske med dem, før du bekræfter fjernelsen. Kontrollér de nye ejere og statusser bagefter. Virksomhedsmedlemskab er adskilt fra en Co-workers plads i teamet. Se Arbejd med Co-workers for arbejderstatus og Eksport og sletning for sletning af konto eller virksomhed.",
    "audience": "company-administrators",
    "maturity": "preview",
    "applicableProductVersions": [
      "V10"
    ],
    "locale": "da",
    "lastVerifiedAt": "2026-10-25"
  },
  {
    "articleId": "company-import-export-da",
    "slug": "da/guides/board-operator/importing-and-exporting",
    "title": "Importér og eksportér virksomheder",
    "summary": "Forhåndsvis, importér, og genopret en virksomhedspakke på en sikker måde",
    "body": "Blentera-virksomheder kan eksporteres som flytbare Markdown-pakker og importeres fra lokale mapper eller GitHub-arkiver. Det gør det muligt at dele virksomhedsopsætninger, kopiere opsætninger og versionsstyre agentteams. Pakkeformat Eksporterede pakker følger den engelske Agent Companies-specifikation og bruger en struktur baseret på Markdown: my-company/ ├── COMPANY.md # Virksomhedsmetadata ├── agents/ │ ├── ceo/AGENT.md # Agentinstruktioner og frontmatter │ └── cto/AGENT.md ├── projects/ │ └── main/PROJECT.md ├── skills/ │ └── review/SKILL.md ├── tasks/ │ └── onboarding/TASK.md └── .paperclip.yaml # Adapteropsætning, miljøinput og rutiner - COMPANY.md indeholder virksomhedens navn, beskrivelse og metadata. - AGENT.md -filer indeholder agentidentitet, rolle og instruktioner. - SKILL.md -filer er kompatible med Agent Skills-økosystemet. - .paperclip.yaml indeholder valgfri Paperclip-specifik opsætning såsom adaptertyper, miljøinput og budgetter. Eksport og import i appen Begge forløb findes også som sider under virksomhedens indstillinger: Export og Import vises i navigationen for virksomhedsindstillinger. Instanser administreret af en cloudplatform: Platformen opretter virksomheden, og import er slået fra. Importsiden og dens knapper skjules, og alle import-API-ruter svarer med 403 og code: cloud managed. Eksport er fortsat tilgængelig afhængigt af din aktuelle adgang og eksportens detaljerapport. Selvhostede instanser beholder importmuligheden. På siden Export kan du vælge præcis, hvilke filer der skal med i pakken. Over filtræet vises panelet Not included in this export — eksportens detaljerapport — med data, som pakken ikke medtager, for eksempel vedhæftninger, godkendelser, omkostningshistorik eller aktivitetslog. Blokerende problemer fremhæves. På siden Import kan du forhåndsvise pakken, løse navnekollisioner og tildele adaptere, før du gennemfører importen. Afkrydsningsfeltet Start imported agents and routines paused er som standard valgt. Det gør, at importerede agenter og rutiner starter på pause. Når importen er færdig, viser panelet Activate imported agents and routines de importerede elementer, der er sat på pause, så du selv kan genoptage agenter og aktivere de rutiner, du vælger. Når du beholder afkrydsningen, forbliver de importerede agenter og rutiner på pause, indtil du aktiverer dem. Bekræft den gennemgåede pakke Forhåndsvis pakken, før du importerer. Appen kontrollerer de løste filer igen, før importen gennemføres. Hvis filerne er ændret, skal du åbne en ny forhåndsvisning, gennemgå ændringerne og bekræfte igen. For GitHub-pakker viser forhåndsvisningen den præcise kildecommit. Alle pakkefiler kommer fra den revision. Hvis grenen flyttes til en anden commit, skal du gennemgå en ny forhåndsvisning, også selv om filerne ser uændrede ud. En ufuldstændig filliste eller en utilgængelig revision stopper forhåndsvisningen. Pakker med uløste undermoduler inde i den valgte mappe understøttes ikke. Brug en pakke, hvor filerne er inkluderet direkte. Lad Start imported agents and routines paused være valgt, mens du gennemgår pakken. En import godkender ikke importerede adgangsoplysninger eller scripts. Gennemgå hver valgt Co-worker og rutine før aktivering. Opgave- og projektindhold kræver i øjeblikket fortsat adgang til de oprindelige kilder i den virksomhed, indholdet kommer fra. Flytning af sådant indhold til en anden virksomhed kræver et godkendt publiceringsforløb, som importsiden ikke tilbyder. En pakke til en ny virksomhed kan indeholde virksomheds- og Co-worker-opsætning uden disse arbejdsemner. Hvis adgangen til kilden afvises, før importen begynder, er anmodningen afvist; det betyder ikke, at arbejdsemnerne blev kopieret. Genopret en afbrudt import En accepteret import har et gemt operations-id. Når siden genindlæses, kontrollerer den den operation i stedet for at indsende pakken igen. Login som en anden bruger giver ikke adgang til den oprindelige brugers importkvittering. Hvis en import til en ny virksomhed stadig kører, eller resultatet er ukendt, før målvirksomheden er bekræftet, kan den oprindelige anmoder finde operationen i Import history for en virksomhed, vedkommende aktuelt har adgang til. Indgangen viser New company, result not yet confirmed . Den identificerer eller beviser ikke, at en virksomhed er oprettet. Når målet er bekræftet, vises operationen i den pågældende virksomheds historik, hvis du har aktuel adgang. - Running: Vent på den gemte operation. Opret ikke en ny import. - Complete: Åbn den importerede virksomhed. Detaljerede navne vises måske ikke længere, men den gemte oversigt identificerer stadig den gennemførte operation, hvis du fortsat har adgang. - Rejected before import: Følg den viste årsag. Hvis pakken er ændret, skal du forhåndsvise de aktuelle filer, før du bekræfter igen. - Outcome unknown: Nogle ændringer kan allerede være gemt. Behold operations-id'et, og kontakt administratoren eller support. Upload ikke pakken igen for at undersøge, om den første import lykkedes. En genstart af serveren bevarer den accepterede operation. Automatisk genafspilning, annullering af en import, der allerede anvender ændringer, og selvbetjent afklaring af et ukendt resultat er ikke tilgængelige i denne forhåndsvisning. Cachen med fulde detaljer er midlertidig. At den forsvinder, giver ikke tilladelse til at starte importen igen. Eksportér en virksomhed med CLI Eksportér en virksomhed til en flytbar mappe: paperclipai company export <company-id --out ./my-export Indstillinger Indstilling Beskrivelse Standard --- --- --- --out <path Outputmappe (påkrævet) — --include <values Kommasepareret udvalg: company, agents, projects, issues, tasks, skills company,agents --skills <values Eksportér kun bestemte skill-slugs alle --projects <values Eksportér kun bestemte projektnavne eller id'er alle --issues <values Eksportér bestemte opgave-id'er eller identifikatorer ingen --project-issues <values Eksportér opgaver, der tilhører bestemte projekter ingen --expand-referenced-skills Medtag skill-filernes indhold i stedet for kun at beholde henvisninger false Eksempler # Eksportér virksomhed med agenter og projekter paperclipai company export abc123 --out ./backup --include company,agents,projects Eksportér alt, inklusive opgaver og skills paperclipai company export abc123 --out ./full-export --include company,agents,projects,tasks,skills Eksportér kun bestemte skills paperclipai company export abc123 --out ./skills-only --include skills --skills review,deploy Hvad eksporten indeholder - Virksomhedens navn, beskrivelse og metadata - Agentnavne, roller, rapporteringsstruktur og instruktioner - Projektdefinitioner og arbejdsområdets opsætning - Opgavebeskrivelser, hvis de er valgt - Skill-pakker som henvisninger eller inkluderede filer - Adaptertype og miljøinputdeklarationer i .paperclip.yaml Gemte hemmelighedsværdier og lokale maskinstier udelades. Eksport af opgaver og projekter indeholder kildeidentiteter, som bruges til at kontrollere en gendannelse. De giver ingen adgang. Gennemgå det valgte indhold for følsomme oplysninger, før du deler en pakke. Importér en virksomhed med CLI Du kan importere fra en lokal mappe, GitHub-URL eller GitHub-genvej: # Fra en lokal mappe paperclipai company import ./my-export Fra en GitHub-URL paperclipai company import https://github.com/org/repo Fra en undermappe på GitHub paperclipai company import https://github.com/org/repo/tree/main/companies/acme Fra GitHub-genvej paperclipai company import org/repo paperclipai company import org/repo/companies/acme Indstillinger Indstilling Beskrivelse Standard --- --- --- --target <mode new (opret en ny virksomhed) eller existing (flet ind i en eksisterende) udledes af konteksten --company-id <id Målvirksomhedens id ved --target existing aktuel kontekst --new-company-name <name Erstat navnet ved --target new fra pakken --include <values Kommasepareret udvalg: company, agents, projects, issues, tasks, skills automatisk registreret --agents <list Kommaseparerede agent-slugs, der skal importeres, eller all alle --collision <mode Håndtering af navnekonflikter: rename, skip eller replace rename --ref <value Git-reference til GitHub-import standardgrenen --dry-run Forhåndsvis importen uden at gennemføre den false --yes Spring interaktiv bekræftelse over false --json Vis resultatet som JSON false Måltilstande - new opretter en ny virksomhed ud fra virksomheds- og Co-worker-opsætning. Opgave- og projektindhold kræver publiceringsforløbet beskrevet ovenfor. - existing fletter pakken ind i en eksisterende virksomhed. Brug --company-id til at vælge målet. Hvis --target ikke angives, udleder Paperclip værdien. Hvis --company-id er angivet eller findes i konteksten, bliver standarden existing; ellers new. Strategier ved navnekonflikt Ved import til en eksisterende virksomhed kan agent- eller projektnavne være i konflikt med eksisterende navne: - rename (standard) tilføjer et suffiks for at undgå konflikter, for eksempel bliver ceo til ceo-2. - skip springer allerede eksisterende elementer over. - replace overskriver elementer. Det er kun tilgængeligt ved import, der ikke er sikker. Det tilbydes ikke gennem CEO-API'et. Interaktivt valg Når kommandoen køres interaktivt uden --yes eller --json, viser importkommandoen en vælger, før den anvender ændringer. Du kan vælge præcis hvilke agenter, projekter, skills og opgaver der skal importeres. Forhåndsvis før anvendelse Forhåndsvis altid først med --dry-run: paperclipai company import org/repo --target existing --company-id abc123 --dry-run Forhåndsvisningen viser: - Pakkeindhold — antal agenter, projekter, opgaver og skills i kilden - Importplan — hvad der oprettes, omdøbes, springes over eller erstattes - Miljøinput — miljøvariabler, der kan være nødvendige efter import - Advarsler — mulige problemer, som manglende skills eller uløste referencer Importerede agenter starter altid med timerbaserede heartbeats slået fra. Tildelt arbejde og opvågning efter behov fra pakken bevares, men planlagte kørsler forbliver slået fra, indtil en bestyrelsesoperatør aktiverer dem igen. Importen kan også angive pauseAutomations (standard i appens Import-side), så importerede agenter og rutiner forbliver på pause. Brug aktiveringspanelet efter importen — eller genoptag agenterne og aktivér rutinerne enkeltvis — når du er klar. Almindelige arbejdsgange Kopiér en virksomhedsskabelon fra GitHub: paperclipai company import org/company-templates/engineering-team \\ --target new \\ --new-company-name \"My Engineering Team\" Tilføj agenter fra en pakke til en eksisterende virksomhed: paperclipai company import ./shared-agents \\ --target existing \\ --company-id abc123 \\ --include agents \\ --collision rename Importér en bestemt gren eller et bestemt tag: paperclipai company import org/repo --ref v2.0.0 --dry-run Kør uden interaktiv dialog, f.eks. i CI eller scripts: paperclipai company import ./package \\ --target new \\ --yes \\ --json API-endpoints CLI-kommandoerne bruger følgende API-endpoints: Handling Endpoint --- --- Eksportér virksomhed POST /api/companies/{companyId}/export Eksportér rapport om pakkens indhold GET /api/companies/{companyId}/export/fidelity Forhåndsvis import til eksisterende virksomhed POST /api/companies/{companyId}/imports/preview Anvend import til eksisterende virksomhed POST /api/companies/{companyId}/imports/apply Forhåndsvis import til ny virksomhed POST /api/companies/import/preview Anvend import til ny virksomhed POST /api/companies/import Importens apply-anmodning accepterer pauseAutomations: true for at oprette importerede agenter og rutiner på pause. CEO-agenter kan også bruge de sikre importruter (/imports/preview og /imports/apply). De afviser replace, håndterer navnekonflikter med rename eller skip, og opretter altid opgaver som nye. GitHub-kilder Paperclip understøtter flere GitHub-URL-formater: - Fuld URL: https://github.com/org/repo - URL til undermappe: https://github.com/org/repo/tree/main/path/to/company - Genvej: org/repo - Genvej med sti: org/repo/path/to/company Brug --ref til at fastlåse en gren, et tag eller et commit-id ved GitHub-import.",
    "audience": "company-administrators",
    "maturity": "preview",
    "applicableProductVersions": [
      "V10"
    ],
    "locale": "da",
    "lastVerifiedAt": "2026-10-25"
  },
  {
    "articleId": "approvals-and-stop-da",
    "slug": "da/guides/board-operator/approvals",
    "title": "Gennemgå godkendelser og stop arbejde",
    "summary": "Undersøg en anmodning, registrér en beslutning, eller stop en aktiv opgavekørsel",
    "body": "En godkendelse er en anmodning om en beslutning. Åbn Approvals for at gennemgå de ventende anmodninger, du har adgang til. Åbn derefter en anmodning for at læse dens detaljer og tilknyttede arbejde, før du beslutter dig. Registrér en godkendelsesbeslutning Anmodningssiden kan vise Approve , Reject eller Request revision . Vælg ud fra den anmodning, der vises. En anmodning om ændringer sender elementet tilbage til rettelse; den godkender ikke handlingen. Kontrollér status på godkendelsessiden efter indsendelse. Nogle apphandlinger har deres egen adgangsgennemgang under Apps . Kontrollér udbyder, konto, tilladelser og handlingens omfang dér. En appforbindelse eller godkendelse af én handling godkender ikke automatisk en anden handling. Sæt opgavearbejde på pause, eller stop det Åbn opgaven for at finde kontrollerne til dens aktive kørsel. Afhængigt af den aktuelle status kan du se Pause work , Stop and done eller Stop and cancel . Pause styrer den aktive kørsel; at markere opgaven som færdig eller annulleret er en særskilt opgavestatus. Læs hver handlings betegnelse og opgavens aktuelle status, før du bruger den. Vent, indtil opgavesiden viser den nye kørsels- og opgavestatus. Hvis resultatet af et stop eller en beslutning er ukendt, skal du genindlæse den oprindelige opgave eller godkendelse og kontrollere dens status, før du gentager handlingen. Se Genoptag afbrudt arbejde for de næste sikre trin.",
    "audience": "company-administrators",
    "maturity": "preview",
    "applicableProductVersions": [
      "V10"
    ],
    "locale": "da",
    "lastVerifiedAt": "2026-10-25"
  },
  {
    "articleId": "export-and-delete-da",
    "slug": "da/help/export-and-delete",
    "title": "Eksportér data, eller anmod om sletning",
    "summary": "Forstå eksport af virksomhed, sletning af organisation og sletning af personlig konto",
    "body": "Blentera har særskilte handlinger til at eksportere en virksomhed, slette en organisation og slette din personlige konto. Kontrollér, hvilke data og hvilken identitet du mener, før du fortsætter. Eksportér virksomhedsdata Åbn Company settings → Export for at vælge de filer, der skal med i virksomhedspakken. Gennemgå forhåndsvisningen og rapporten Not included in this export , før du henter pakken. En virksomhedseksport er en flytbar pakke, ikke en kopi af alle databaseposter eller data hos eksterne udbydere. Se Importér og eksportér virksomheder for pakkens aktuelle indhold og hjælp til importgenopretning. Anmod om sletning af organisation Åbn Company settings → Deletion for at gennemgå anmodningen om at slette organisationen. Siden beder dig først eksportere organisationen, bekræfte dens navn og anerkende sletningen. Sletning stopper arbejdet og starter den viste afviklingsproces. Den kan ikke fortrydes. Sletningen kan forblive i en opbevaringstilstand, mens administrerede sikkerhedskopier når deres slettefrist. Finansielle poster og en minimal kvittering for sletning kan blive gemt, hvor det kræves. Følg status og trin på sletningssiden. En indsendt anmodning beviser ikke, at den endelige sletning er gennemført. Anmod om sletning af personlig konto Åbn Company settings → Security for at gennemgå sletning af din personlige konto. Formularen kræver din aktuelle adgangskode, teksten DELETE MY ACCOUNT og en bekræftelse af, at du har gemt de eksporter, du har brug for. Hvis anmodningen accepteres, viderestilles kontosiden og viser en kvittering, når den er tilgængelig. Hvis en tidligere anmodning har et ukendt resultat, skal du bruge gendannelsen på kontosiden i stedet for at indsende en ny anmodning. Ved spørgsmål om privatliv kan du skrive til privacy@blentera.com. Send ikke din adgangskode, gendannelseskode eller API-nøgle. Gennemgå deling af privat Memory (preview) Når Memory er slået til, viser et forslag om privat deling det præcise indhold og destinationen. Gennemgå begge dele, før du vælger Godkend og del . Kun den oprindelige ejer kan godkende delingen fra sin aktuelle konto. Almindelig gennemgang af Memory udvider ikke adgangen til private kilder. Den private original forbliver privat. Modtagere skal fortsat have aktuel adgang til destinationen og de bevarede kilder. Deling af Memory offentliggør ikke en underliggende privat opgave. En delt kopi kan blive utilgængelig, hvis kilden ændres, udløber, trækkes tilbage eller slettes. Sletning af den delte kopi sletter ikke den private original.",
    "audience": "company-administrators",
    "maturity": "preview",
    "applicableProductVersions": [
      "V10"
    ],
    "locale": "da",
    "lastVerifiedAt": "2026-10-25"
  },
  {
    "articleId": "billing-and-capacity-da",
    "slug": "da/guides/board-operator/costs-and-budgets",
    "title": "Fakturering og kapacitet",
    "summary": "Kontrollér abonnement, tilgængelig kapacitet, forbrug og betalingsmuligheder",
    "body": "Åbn Company settings → Billing for at kontrollere abonnements- og kapacitetsoplysningerne for den valgte virksomhed. Fakturering kan være utilgængelig i nogle installationer. Siden fortæller dig, hvis det er tilfældet. Forstå, hvad der faktureres Faktureringssiden adskiller Blenteras betalte kapacitet og administrerede infrastruktur fra de gebyrer, din model- eller runtimeudbyder opkræver. Kontrollér de særskilte gebyrer på udbyderens egen konto. Siden viser den aktuelle adgangstilstand, abonnementsstatus, tilgængelige planer og de forbrugsdetaljer, som din installation understøtter. Hvis siden viser Free Core , skal du læse de viste grænser og tilgængelighed dér. Hvis den viser en fristperiode eller skrivebeskyttet adgang, skal du følge handlingen på faktureringssiden. Ved skrivebeskyttet adgang fortæller siden, at du kan se og eksportere dit arbejde, mens ændringer ikke er tilgængelige. Administrér betaling, eller opsig Vælg Manage payment and subscription for at åbne betalingsudbyderens portal. Gennemgå abonnementet og dets vilkår dér. Hvis abonnementet tilbyder opsigelse i portalen, skal du gennemføre den dér og vende tilbage til Blentera for at kontrollere status. En status som Cancels at the end of this period vises først, når abonnementsstatus er meldt tilbage. Hvis betalingssiden siger, at udbyderen ikke har bekræftet resultatet, skal du ikke starte en ny betaling blot for at kontrollere. Følg afklaringsbeskeden på faktureringssiden, eller kontakt menneskelig support. Handlingen Refresh subscription er tilgængelig efter en gennemført, udløbet eller fejlet betaling. Sletning af konto og organisation er adskilt fra abonnementsændringer. Se Eksport og sletning, før du anmoder om en af delene.",
    "audience": "company-administrators",
    "maturity": "preview",
    "applicableProductVersions": [
      "V10"
    ],
    "locale": "da",
    "lastVerifiedAt": "2026-10-25"
  },
  {
    "articleId": "recovering-work-da",
    "slug": "da/help/recovering-work",
    "title": "Genoptag afbrudt arbejde",
    "summary": "Kontrollér opgavens aktuelle status, og brug den viste næste handling sikkert",
    "body": "Når en opgave ikke længere gør fremskridt, skal du åbne den oprindelige opgave og kontrollere dens aktuelle status, aktivitet, kørselsoversigt og besked om næste trin. Et fejlslagent svar i browseren betyder ikke altid, at opgaven fejlede. Serveren kan have accepteret den oprindelige handling. Kontrollér, før du prøver igen Læs den seneste kørsel og eventuelle blokeringer eller genoprettelsesbeskeder. Løs den nævnte forbindelse, godkendelse, ejer eller anden forudsætning, hvis du kan. Brug kun handlingen til et nyt forsøg, hvis den vises for den pågældende opgave og aktuelle status. Hvis der ikke vises en sådan handling, skal du bede opgavens ejer eller en administrator gennemgå kørslen, før du opretter erstatningsarbejde. Hvis et planlagt nyt forsøg vises, skal du kun bruge opgavens Retry now , hvis du vil fremrykke det eksisterende forsøg. Handlingen opretter ikke en separat opgave. Kontrollér status igen, når handlingen er færdig. Hvis en Co-workers opdatering afvises, fordi adgangen til dens begrænsede kilder ikke kan bevares, forbliver opgavens eksisterende indhold uændret. Behold den oprindelige opgave, og bed dens ejer eller menneskelig support gennemgå afvisningen, før du gentager opdateringen. Mens et stop afventer Lad opgaven stå åben, mens stophandlingen afventer. Vent, indtil kørsels- og opgavestatus opdateres. Hvis siden melder om et ukendt resultat, skal du genindlæse den oprindelige opgave og gennemgå den seneste kørsel, før du sender en ny instruktion eller starter erstatningsarbejde. Ved en uløst fejl kan du kontakte menneskelig support med opgave-id'et og den ikke-hemmelige besked på skærmen. Medtag ikke adgangsoplysninger eller private opgaveoplysninger, som modtageren ikke har adgang til.",
    "audience": "company-members",
    "maturity": "preview",
    "applicableProductVersions": [
      "V10"
    ],
    "locale": "da",
    "lastVerifiedAt": "2026-10-25"
  },
  {
    "articleId": "help-and-human-support-da",
    "slug": "da/help/index",
    "title": "Hjælp og menneskelig support",
    "summary": "Find vejledning, se dine sager, eller kontakt en person direkte",
    "body": "Åbn Hjælp / Support i appen for at gennemse vejledning, åbne supportsager eller kontrollere den konfigurerede statusside. Du kan kontakte menneskelig support direkte på support@blentera.com. Du behøver ikke først tale med en assistent. Søg efter produktord i Hjælp for at finde relevant vejledning. Hjælpeartiklerne findes på dansk og engelsk. Søgningen bruger det aktuelle visningssprog. Når du åbner et resultat i en ny fane, forbliver arbejdet og Hjælp-visningen tilgængelige. Du kan også finde hjælpeartikler i den aktuelle kommandopalette. Tryk Ctrl+K på Windows eller Linux eller ⌘K på Mac, og skriv et emne. Når du vælger en hjælpeartikel, åbnes den i en ny fane, og fokus vender tilbage til den kontrol, du brugte til at åbne paletten. Den eksisterende Arbejde-visning forbliver tilgængelig. Når du åbner Hjælp, mens du arbejder i samme virksomhed, kan du lukke den for at vende tilbage til den oprindelige visning. Skriv ikke adgangskoder, gendannelseskoder, API-nøgler eller andre hemmeligheder i en supportbesked. Gennemgå diagnosticeringsoplysninger, før du deler dem. Supportsager Vælg Mine supportsager for at sende en anmodning eller læse en eksisterende sag. En gemt kvittering bekræfter, at anmodningen blev gemt. Den bekræfter ikke i sig selv levering til en ekstern supportudbyder eller svartid. Følg behandlingsbeskeden, der vises før afsendelse. Indsendelse kan være utilgængelig, hvis beskeden ikke er konfigureret. Hvis resultatet af en indsendelse er ukendt, skal du beholde den oprindelige anmodning på siden og bruge dens genoprettelseshandling. Genindlæsning kontrollerer, om kvitteringen er gemt. Opret ikke en ny anmodning alene, fordi svaret blev afbrudt. Hvis en gemt sag viser ukendt levering, skal du beholde sagsreferencen og kontakte support direkte. Et afbrudt leveringsforsøg sendes ikke automatisk igen, fordi udbyderen allerede kan have modtaget det. Åbn en sag for at læse svar fra support. Afventer dit svar viser, hvad support har brug for fra dig. Et svar på en løst sag genåbner den samme sag. Et svar på en afsluttet sag opretter en tilknyttet opfølgning og bevarer den oprindelige historik. Indberet et sikkerheds- eller privatlivsproblem Brug security@blentera.com ved sikkerhedsproblemer og privacy@blentera.com ved privatlivsanmodninger. Del kun de oplysninger, der er nødvendige for at forklare problemet. Send aldrig en adgangsoplysning for at bevise, at den tilhører dig. Genopretning af import Ved en kørende eller afbrudt virksomhedsimport skal du følge Importér og eksportér virksomheder. Hvis resultatet er ukendt, skal det afklares, før det er sikkert at starte en ny import. Teknisk dokumentation De øvrige dokumentationsfaner dækker native protokoller, selvhosting, adaptere og udvikler-API'er. Tekniske navne som Paperclip Runner, paperclipai og .paperclip.yaml identificerer de underliggende komponenter og pakkeformater.",
    "audience": "company-members",
    "maturity": "preview",
    "applicableProductVersions": [
      "V10"
    ],
    "locale": "da",
    "lastVerifiedAt": "2026-10-25"
  },
  {
    "articleId": "preview-and-known-limits-da",
    "slug": "da/guides/board-operator/experimental-features",
    "title": "Forhåndsvisning, eksperimenter og kendte begrænsninger",
    "summary": "Forstå mærkater for forhåndsvisning og eksperimenter, og find aktuel status",
    "body": "Funktioners tilgængelighed kan variere mellem installationer og virksomheder. En funktion markeret Preview eller Experimental er stadig under udvikling. Siden for eksperimentelle indstillinger siger, at eksperimentelle funktioner kan gå i stykker. Gør ikke en sådan funktion kritisk for en proces, medmindre dit team accepterer risikoen. Kontrollér, om en funktion er tilgængelig Se efter funktionen i appen, og læs dens aktuelle mærkat og opsætningsbesked. Hvis du ikke kan se den, skal du spørge instansadministratoren, om den er slået til for din installation. Gå ikke ud fra, at en funktion findes, blot fordi den står i en API- eller udviklerreference. En eksperimentel indstilling styres på instansniveau, når kontrollen vises. Spørg instansadministratoren, før du ændrer den. Før du slår en indstilling fra, hvis den vedrører en kørende integration, skal du kontrollere funktionens egen vejledning og aktuelle status. Udgivelsesoplysninger og servicehændelser Dette Hjælp-center har endnu ikke en komplet historik over funktioner fra udgivelse til udgivelse. Brug funktionens aktuelle skærmbillede og tilknyttede vejledning til at se tilgængelighed og begrænsninger. Åbn Hjælp og menneskelig support for at spørge til en konkret produktbegrænsning. Hvis Hjælp viser en konfigureret statusside, kan du kontrollere anmeldte servicehændelser dér. Den beskriver ikke alle funktionsbegrænsninger.",
    "audience": "company-members",
    "maturity": "preview",
    "applicableProductVersions": [
      "V10"
    ],
    "locale": "da",
    "lastVerifiedAt": "2026-10-25"
  },
  {
    "articleId": "developer-and-advanced-da",
    "slug": "da/help/developer-and-advanced",
    "title": "Dokumentation for udviklere og avancerede brugere",
    "summary": "Find API-, CLI-, installations- og avancerede konfigurationsreferencer",
    "body": "Brug den eksisterende engelske dokumentation til teknisk opsætning og integration: - API-oversigt, godkendelse og API-reference - CLI-oversigt og opsætningskommandoer - Installationsmåder, hemmeligheder og miljøvariabler API- og CLI-referencerne beskriver deres egne understøttede kommandoer og endpoints. Tilgængeligheden kan afhænge af din installation, aktiverede funktioner og aktuelle autorisation. Brug dokumentationen til den installerede version, og kontrollér den aktuelle side eller API-svar, før du gentager en skrivehandling efter et afbrudt svar. Ved hjælp til en kundeopgave skal du bruge Hjælp og menneskelig support i stedet for at lægge private data eller adgangsoplysninger i en udviklerlog.",
    "audience": "developers-and-instance-administrators",
    "maturity": "preview",
    "applicableProductVersions": [
      "V10"
    ],
    "locale": "da",
    "lastVerifiedAt": "2026-10-25"
  }
];
