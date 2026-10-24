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
    "body": "Blentera companies can be exported to portable markdown packages and imported from local directories or GitHub repositories. This lets you share company configurations, duplicate setups, and version-control your agent teams. Package Format Exported packages follow the Agent Companies specification and use a markdown-first structure: my-company/ ├── COMPANY.md # Company metadata ├── agents/ │ ├── ceo/AGENT.md # Agent instructions + frontmatter │ └── cto/AGENT.md ├── projects/ │ └── main/PROJECT.md ├── skills/ │ └── review/SKILL.md ├── tasks/ │ └── onboarding/TASK.md └── .paperclip.yaml # Adapter config, env inputs, routines - COMPANY.md defines company name, description, and metadata. - AGENT.md files contain agent identity, role, and instructions. - SKILL.md files are compatible with the Agent Skills ecosystem. - .paperclip.yaml holds Paperclip-specific config (adapter types, env inputs, budgets) as an optional sidecar. Export & Import in the App Both flows are also available in the web UI as company settings pages: Export and Import appear in the company settings navigation. Cloud-managed instances: when a hosting platform manages the instance, the company is provisioned by the platform and importing is disabled — the Import page and buttons are hidden, and every import API route answers 403 with code: \"cloud managed\" . Export stays available subject to your current access and the export fidelity report. Self-hosted instances keep the full import surface. The Export page lets you pick exactly which files go into the bundle before downloading it. Above the file tree it shows a \"Not included in this export\" panel — the export fidelity report — listing data the bundle will not carry (for example attachments, approvals, cost history, or activity log entries), with blocking issues highlighted. The Import page previews the package, lets you resolve name collisions and adapter assignments, and applies the import. A \"Start imported agents and routines paused\" checkbox (on by default) makes imported agents and routines land paused instead of live. After the import finishes, an \"Activate imported agents and routines\" panel lists everything that was imported paused so you can resume the agents and activate the routines you select — nothing starts running until you say so. Confirm the reviewed package Preview the package before importing. The app checks the resolved files again before applying the import. If the files changed, open a new preview, review the changes, and confirm again. For GitHub packages, the preview shows the exact source commit. All package files come from that revision. If the branch moves to a different commit, review a new preview even when the files appear unchanged. An incomplete file list or an unavailable revision stops the preview. Packages with unresolved submodules inside the selected directory are not supported; use a package whose files are included directly. Keep Start imported agents and routines paused selected while reviewing a package. An import does not authorize imported credentials or scripts. Review each selected Co-worker and routine before activation. Recover an interrupted import An accepted import has a saved operation ID. Reloading the page checks that operation instead of submitting the package again. Signing in as another user does not give access to the original user's import receipt. If a new-company import is still running or its result is unknown before a target company is confirmed, its original requester can find the operation in the Import history for a company they can currently access. The entry says New company, result not yet confirmed . It does not identify or prove that a company was created. Once the target is confirmed, the operation appears in that company's history when you have current access. - Running: wait for the saved operation. Do not create a second import. - Complete: open the imported company. Detailed names may no longer be available, while the saved summary still identifies the completed operation where you retain access. - Rejected before import: follow the reason shown. For a changed package, preview the current files before confirming again. - Outcome unknown: some changes may already have been saved. Keep the operation ID and contact your administrator or support. Do not upload the package again to find out whether the first import worked. A server restart preserves the accepted operation. Automatic replay, cancellation of an import already applying changes, and self-service reconciliation of an unknown result are not available in this preview. The full-detail cache is temporary; its loss does not authorize another import. Exporting a Company Export a company into a portable folder: paperclipai company export <company-id --out ./my-export Options Option Description Default -------- ------------- --------- --out <path Output directory (required) — --include <values Comma-separated set: company , agents , projects , issues , tasks , skills company,agents --skills <values Export only specific skill slugs all --projects <values Export only specific project shortnames or IDs all --issues <values Export specific issue identifiers or IDs none --project-issues <values Export issues belonging to specific projects none --expand-referenced-skills Vendor skill file contents instead of keeping upstream references false Examples # Export company with agents and projects paperclipai company export abc123 --out ./backup --include company,agents,projects Export everything including tasks and skills paperclipai company export abc123 --out ./full-export --include company,agents,projects,tasks,skills Export only specific skills paperclipai company export abc123 --out ./skills-only --include skills --skills review,deploy What Gets Exported - Company name, description, and metadata - Agent names, roles, reporting structure, and instructions - Project definitions and workspace config - Task/issue descriptions (when included) - Skill packages (as references or vendored content) - Adapter type and env input declarations in .paperclip.yaml Secret values, machine-local paths, and database IDs are never exported. Importing a Company Import from a local directory, GitHub URL, or GitHub shorthand: # From a local folder paperclipai company import ./my-export From a GitHub URL paperclipai company import https://github.com/org/repo From a GitHub subfolder paperclipai company import https://github.com/org/repo/tree/main/companies/acme From GitHub shorthand paperclipai company import org/repo paperclipai company import org/repo/companies/acme Options Option Description Default -------- ------------- --------- --target <mode new (create a new company) or existing (merge into existing) inferred from context --company-id <id Target company ID for --target existing current context --new-company-name <name Override company name for --target new from package --include <values Comma-separated set: company , agents , projects , issues , tasks , skills auto-detected --agents <list Comma-separated agent slugs to import, or all all --collision <mode How to handle name conflicts: rename , skip , or replace rename --ref <value Git ref for GitHub imports (branch, tag, or commit) default branch --dry-run Preview what would be imported without applying false --yes Skip the interactive confirmation prompt false --json Output result as JSON false Target Modes - new — Creates a fresh company from the package. Good for duplicating a company template. - existing — Merges the package into an existing company. Use --company-id to specify the target. If --target is not specified, Paperclip infers it: if a --company-id is provided (or one exists in context), it defaults to existing ; otherwise new . Collision Strategies When importing into an existing company, agent or project names may conflict with existing ones: - rename (default) — Appends a suffix to avoid conflicts (e.g., ceo becomes ceo-2 ). - skip — Skips entities that already exist. - replace — Overwrites existing entities. Only available for non-safe imports (not available through the CEO API). Interactive Selection When running interactively (no --yes or --json flags), the import command shows a selection picker before applying. You can choose exactly which agents, projects, skills, and tasks to import using a checkbox interface. Preview Before Applying Always preview first with --dry-run : paperclipai company import org/repo --target existing --company-id abc123 --dry-run The preview shows: - Package contents — How many agents, projects, tasks, and skills are in the source - Import plan — What will be created, renamed, skipped, or replaced - Env inputs — Environment variables that may need values after import - Warnings — Potential issues like missing skills or unresolved references Imported agents always land with timer heartbeats disabled. Assignment/on-demand wake behavior from the package is preserved, but scheduled runs stay off until a board operator re-enables them. Imports can additionally request pauseAutomations (the default in the app's Import page) so imported agents and routines land fully paused. Use the post-import activation panel — or resume the agents and activate the routines individually — when you are ready for them to run. Common Workflows Clone a company template from GitHub: paperclipai company import org/company-templates/engineering-team \\ --target new \\ --new-company-name \"My Engineering Team\" Add agents from a package into your existing company: paperclipai company import ./shared-agents \\ --target existing \\ --company-id abc123 \\ --include agents \\ --collision rename Import a specific branch or tag: paperclipai company import org/repo --ref v2.0.0 --dry-run Non-interactive import (CI/scripts): paperclipai company import ./package \\ --target new \\ --yes \\ --json API Endpoints The CLI commands use these API endpoints under the hood: Action Endpoint -------- ---------- Export company POST /api/companies/{companyId}/export Export fidelity report GET /api/companies/{companyId}/export/fidelity Preview import (existing company) POST /api/companies/{companyId}/imports/preview Apply import (existing company) POST /api/companies/{companyId}/imports/apply Preview import (new company) POST /api/companies/import/preview Apply import (new company) POST /api/companies/import Import apply requests accept pauseAutomations: true to create imported agents and routines in a paused state. CEO agents can also use the safe import routes ( /imports/preview and /imports/apply ) which enforce non-destructive rules: replace is rejected, collisions resolve with rename or skip , and issues are always created as new. GitHub Sources Paperclip supports several GitHub URL formats: - Full URL: https://github.com/org/repo - Subfolder URL: https://github.com/org/repo/tree/main/path/to/company - Shorthand: org/repo - Shorthand with path: org/repo/path/to/company Use --ref to pin to a specific branch, tag, or commit hash when importing from GitHub.",
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
    "body": "Blentera has separate actions for exporting a company, deleting an organization, and deleting your personal account. Check which data and identity you mean before continuing. Export company data Open Company settings → Export to choose the files included in a company package. Review the export preview and its Not included in this export report before downloading. A company export is a portable package, not a copy of every database record or provider-held item. See Importing and exporting companies for the current package contents and import recovery guidance. Request organization deletion Open Company settings → Deletion to review the organization deletion request. The page asks you to export the organization first, confirm its name, and acknowledge the deletion. Organization deletion stops work and begins the displayed offboarding process. It cannot be undone. Deletion may remain in a retention state while managed backups reach their deletion date. Financial records and a minimal deletion receipt may be retained where required. Follow the status and stage shown on the deletion page; a submitted request is not proof that final erasure has completed. Request personal account deletion Open Company settings → Security to review personal account deletion. The form requires your current password, the text DELETE MY ACCOUNT , and acknowledgement that you saved the exports you need. If the request is accepted, the account page redirects and provides a deletion receipt when available. If an earlier request has an unknown result, use the recovery shown on the account page instead of starting a new request. For a privacy question, contact privacy@blentera.com. Do not send your password, recovery code, or API key.",
    "audience": "company-administrators",
    "maturity": "preview",
    "applicableProductVersions": [
      "V10"
    ],
    "locale": "en",
    "lastVerifiedAt": "2026-10-24"
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
    "body": "When a task stops making progress, open the original task and check its current status, activity, run history, and next-step notice. A failed response from your browser does not always mean the task failed; the server may have accepted the original action. Check before retrying Read the latest run and any blocker or recovery message. Resolve the named connection, approval, owner, or other requirement if you can. Use a retry action only when it is shown for that task and the current state. If there is no retry action, ask the task owner or an administrator to review the run before creating replacement work. If a scheduled retry is shown, use the task’s Retry now action only if you want to bring that existing retry forward. It does not create a separate task. Check the status again after the action completes. When a stop is pending Keep the task open while a stop action is pending. Wait for the run and task status to update. If the page reports an unknown outcome, refresh the original task and inspect its latest run before sending another instruction or starting replacement work. For help with an unresolved error, contact human support with the task identifier and the non-secret message shown on screen. Do not include credentials or private task information that the recipient cannot access.",
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
    "body": "Open Help in the app to browse guidance, open support cases, or check the configured service status page. You can contact human support directly at support@blentera.com. You do not need to converse with an assistant first. Search product terms inside Help to find matching guidance. Open a result in a new tab to keep your work and the Help view available. When you open Help from signed-in work in the same company, close it to return to your original view. Do not put passwords, recovery codes, API keys, or other secrets in a support message. Review any diagnostic information before sharing it. Support cases Choose Support cases to send a request or read an existing case. A saved case receipt confirms that the request was stored. It does not by itself confirm delivery to an external support provider or a response time. Follow the processing notice shown before sending; intake may be unavailable when that notice is not configured. If a submission's result is unknown, keep the page's original request and use its recovery action. Reload checks for the saved receipt. Do not create another request solely because the response was interrupted. Report a security or privacy concern Use security@blentera.com for a security concern and privacy@blentera.com for a privacy request. Share only the information needed to explain the concern. Never send a credential to prove that you possess it. Import recovery For a running or interrupted company import, follow Importing and exporting companies. An unknown result needs reconciliation before another import can safely run. Technical documentation The other documentation tabs cover native protocols, self-hosting, adapters, and developer APIs. Technical names such as Paperclip Runner, paperclipai , and .paperclip.yaml identify the underlying components and package formats.",
    "audience": "company-members",
    "maturity": "preview",
    "applicableProductVersions": [
      "V10"
    ],
    "locale": "en",
    "lastVerifiedAt": "2026-10-24"
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
  }
];
