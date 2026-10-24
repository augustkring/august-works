---
title: Importing & Exporting Companies
summary: Preview, import, and recover a company package safely
help_article_id: company-import-export
audience: company-administrators
product_capability_refs: [V10-021, V10-022, V10-023]
screen_contract_refs: [CompanyImport]
owner: augustkring/august-works
maturity: preview
applicable_product_versions: [V10]
locale: en
last_verified_at: 2026-10-24
review_trigger: Import source, receipt, recovery, authorization, or retention behavior changes
security_or_privacy_sensitive: true
---

Blentera companies can be exported to portable markdown packages and imported from local directories or GitHub repositories. This lets you share company configurations, duplicate setups, and version-control your agent teams.

## Package Format

Exported packages follow the [Agent Companies specification](/companies/companies-spec) and use a markdown-first structure:

```text
my-company/
├── COMPANY.md          # Company metadata
├── agents/
│   ├── ceo/AGENT.md    # Agent instructions + frontmatter
│   └── cto/AGENT.md
├── projects/
│   └── main/PROJECT.md
├── skills/
│   └── review/SKILL.md
├── tasks/
│   └── onboarding/TASK.md
└── .paperclip.yaml     # Adapter config, env inputs, routines
```

- **COMPANY.md** defines company name, description, and metadata.
- **AGENT.md** files contain agent identity, role, and instructions.
- **SKILL.md** files are compatible with the Agent Skills ecosystem.
- **.paperclip.yaml** holds Paperclip-specific config (adapter types, env inputs, budgets) as an optional sidecar.

## Export & Import in the App

Both flows are also available in the web UI as company settings pages: **Export** and **Import** appear in the company settings navigation.

> **Cloud-managed instances:** when a hosting platform manages the instance, the company is provisioned by the platform and importing is disabled — the Import page and buttons are hidden, and every import API route answers `403` with `code: "cloud_managed"`. Export stays available, so you can always take your company's data with you. Self-hosted instances keep the full import surface.

The **Export** page lets you pick exactly which files go into the bundle before downloading it. Above the file tree it shows a **"Not included in this export"** panel — the export fidelity report — listing data the bundle will not carry (for example attachments, approvals, cost history, or activity log entries), with blocking issues highlighted.

The **Import** page previews the package, lets you resolve name collisions and adapter assignments, and applies the import. A **"Start imported agents and routines paused"** checkbox (on by default) makes imported agents and routines land paused instead of live. After the import finishes, an **"Activate imported agents and routines"** panel lists everything that was imported paused so you can resume the agents and activate the routines you select — nothing starts running until you say so.

## Confirm the reviewed package

Preview the package before importing. The app checks the resolved files again before applying the import. If the files changed, open a new preview, review the changes, and confirm again. This also applies when a GitHub URL still has the same name but its branch contents changed.

Keep **Start imported agents and routines paused** selected while reviewing a package. An import does not authorize imported credentials or scripts. Review each selected Co-worker and routine before activation.

## Recover an interrupted import

An accepted import has a saved operation ID. Reloading the page checks that operation instead of submitting the package again. Signing in as another user does not give access to the original user's import receipt.

- **Running:** wait for the saved operation. Do not create a second import.
- **Complete:** open the imported company. Detailed names may no longer be available, while the saved summary still identifies the completed operation where you retain access.
- **Rejected before import:** follow the reason shown. For a changed package, preview the current files before confirming again.
- **Outcome unknown:** some changes may already have been saved. Keep the operation ID and contact your administrator or [support](/help/index). Do not upload the package again to find out whether the first import worked.

A server restart preserves the accepted operation. Automatic replay, cancellation of an import already applying changes, and self-service reconciliation of an unknown result are not available in this preview. The full-detail cache is temporary; its loss does not authorize another import.

## Exporting a Company

Export a company into a portable folder:

```sh
paperclipai company export <company-id> --out ./my-export
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--out <path>` | Output directory (required) | — |
| `--include <values>` | Comma-separated set: `company`, `agents`, `projects`, `issues`, `tasks`, `skills` | `company,agents` |
| `--skills <values>` | Export only specific skill slugs | all |
| `--projects <values>` | Export only specific project shortnames or IDs | all |
| `--issues <values>` | Export specific issue identifiers or IDs | none |
| `--project-issues <values>` | Export issues belonging to specific projects | none |
| `--expand-referenced-skills` | Vendor skill file contents instead of keeping upstream references | `false` |

### Examples

```sh
# Export company with agents and projects
paperclipai company export abc123 --out ./backup --include company,agents,projects

# Export everything including tasks and skills
paperclipai company export abc123 --out ./full-export --include company,agents,projects,tasks,skills

# Export only specific skills
paperclipai company export abc123 --out ./skills-only --include skills --skills review,deploy
```

### What Gets Exported

- Company name, description, and metadata
- Agent names, roles, reporting structure, and instructions
- Project definitions and workspace config
- Task/issue descriptions (when included)
- Skill packages (as references or vendored content)
- Adapter type and env input declarations in `.paperclip.yaml`

Secret values, machine-local paths, and database IDs are **never** exported.

## Importing a Company

Import from a local directory, GitHub URL, or GitHub shorthand:

```sh
# From a local folder
paperclipai company import ./my-export

# From a GitHub URL
paperclipai company import https://github.com/org/repo

# From a GitHub subfolder
paperclipai company import https://github.com/org/repo/tree/main/companies/acme

# From GitHub shorthand
paperclipai company import org/repo
paperclipai company import org/repo/companies/acme
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--target <mode>` | `new` (create a new company) or `existing` (merge into existing) | inferred from context |
| `--company-id <id>` | Target company ID for `--target existing` | current context |
| `--new-company-name <name>` | Override company name for `--target new` | from package |
| `--include <values>` | Comma-separated set: `company`, `agents`, `projects`, `issues`, `tasks`, `skills` | auto-detected |
| `--agents <list>` | Comma-separated agent slugs to import, or `all` | `all` |
| `--collision <mode>` | How to handle name conflicts: `rename`, `skip`, or `replace` | `rename` |
| `--ref <value>` | Git ref for GitHub imports (branch, tag, or commit) | default branch |
| `--dry-run` | Preview what would be imported without applying | `false` |
| `--yes` | Skip the interactive confirmation prompt | `false` |
| `--json` | Output result as JSON | `false` |

### Target Modes

- **`new`** — Creates a fresh company from the package. Good for duplicating a company template.
- **`existing`** — Merges the package into an existing company. Use `--company-id` to specify the target.

If `--target` is not specified, Paperclip infers it: if a `--company-id` is provided (or one exists in context), it defaults to `existing`; otherwise `new`.

### Collision Strategies

When importing into an existing company, agent or project names may conflict with existing ones:

- **`rename`** (default) — Appends a suffix to avoid conflicts (e.g., `ceo` becomes `ceo-2`).
- **`skip`** — Skips entities that already exist.
- **`replace`** — Overwrites existing entities. Only available for non-safe imports (not available through the CEO API).

### Interactive Selection

When running interactively (no `--yes` or `--json` flags), the import command shows a selection picker before applying. You can choose exactly which agents, projects, skills, and tasks to import using a checkbox interface.

### Preview Before Applying

Always preview first with `--dry-run`:

```sh
paperclipai company import org/repo --target existing --company-id abc123 --dry-run
```

The preview shows:
- **Package contents** — How many agents, projects, tasks, and skills are in the source
- **Import plan** — What will be created, renamed, skipped, or replaced
- **Env inputs** — Environment variables that may need values after import
- **Warnings** — Potential issues like missing skills or unresolved references

Imported agents always land with timer heartbeats disabled. Assignment/on-demand wake behavior from the package is preserved, but scheduled runs stay off until a board operator re-enables them.

Imports can additionally request `pauseAutomations` (the default in the app's Import page) so imported agents and routines land fully paused. Use the post-import activation panel — or resume the agents and activate the routines individually — when you are ready for them to run.

### Common Workflows

**Clone a company template from GitHub:**

```sh
paperclipai company import org/company-templates/engineering-team \
  --target new \
  --new-company-name "My Engineering Team"
```

**Add agents from a package into your existing company:**

```sh
paperclipai company import ./shared-agents \
  --target existing \
  --company-id abc123 \
  --include agents \
  --collision rename
```

**Import a specific branch or tag:**

```sh
paperclipai company import org/repo --ref v2.0.0 --dry-run
```

**Non-interactive import (CI/scripts):**

```sh
paperclipai company import ./package \
  --target new \
  --yes \
  --json
```

## API Endpoints

The CLI commands use these API endpoints under the hood:

| Action | Endpoint |
|--------|----------|
| Export company | `POST /api/companies/{companyId}/export` |
| Export fidelity report | `GET /api/companies/{companyId}/export/fidelity` |
| Preview import (existing company) | `POST /api/companies/{companyId}/imports/preview` |
| Apply import (existing company) | `POST /api/companies/{companyId}/imports/apply` |
| Preview import (new company) | `POST /api/companies/import/preview` |
| Apply import (new company) | `POST /api/companies/import` |

Import apply requests accept `pauseAutomations: true` to create imported agents and routines in a paused state.

CEO agents can also use the safe import routes (`/imports/preview` and `/imports/apply`) which enforce non-destructive rules: `replace` is rejected, collisions resolve with `rename` or `skip`, and issues are always created as new.

## GitHub Sources

Paperclip supports several GitHub URL formats:

- Full URL: `https://github.com/org/repo`
- Subfolder URL: `https://github.com/org/repo/tree/main/path/to/company`
- Shorthand: `org/repo`
- Shorthand with path: `org/repo/path/to/company`

Use `--ref` to pin to a specific branch, tag, or commit hash when importing from GitHub.
