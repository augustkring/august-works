// Generated from the checked Help Center navigation and article frontmatter.
export type CompanySearchHelpArticle = {
  articleId: string; slug: string; title: string; summary: string; body: string; audience: string;
  maturity: "preview" | "ga"; applicableProductVersions: string[]; locale: string; lastVerifiedAt: string;
};
export const COMPANY_SEARCH_HELP_ARTICLES: readonly CompanySearchHelpArticle[] = [
  {
    "articleId": "help-and-human-support",
    "slug": "help",
    "title": "Help and human support",
    "summary": "Find guidance, view your cases, or contact a person directly",
    "body": "Open Help in the app to browse guidance, open support cases, or check the configured service status page. You can contact human support directly at support@blentera.com. You do not need to converse with an assistant first. When you open Help from signed-in work in the same company, close it to return to your original view. Do not put passwords, recovery codes, API keys, or other secrets in a support message. Review any diagnostic information before sharing it. Support cases Choose Support cases to send a request or read an existing case. A saved case receipt confirms that the request was stored. It does not by itself confirm delivery to an external support provider or a response time. Follow the processing notice shown before sending; intake may be unavailable when that notice is not configured. If a submission's result is unknown, keep the page's original request and use its recovery action. Reload checks for the saved receipt. Do not create another request solely because the response was interrupted. Report a security or privacy concern Use security@blentera.com for a security concern and privacy@blentera.com for a privacy request. Share only the information needed to explain the",
    "audience": "company-members",
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
    "body": "Blentera companies can be exported to portable markdown packages and imported from local directories or GitHub repositories. This lets you share company configurations, duplicate setups, and version-control your agent teams. Package Format Exported packages follow the Agent Companies specification and use a markdown-first structure: - COMPANY.md defines company name, description, and metadata. - AGENT.md files contain agent identity, role, and instructions. - SKILL.md files are compatible with the Agent Skills ecosystem. - .paperclip.yaml holds Paperclip-specific config (adapter types, env inputs, budgets) as an optional sidecar. Export & Import in the App Both flows are also available in the web UI as company settings pages: Export and Import appear in the company settings navigation. Cloud-managed instances: when a hosting platform manages the instance, the company is provisioned by the platform and importing is disabled — the Import page and buttons are hidden, and every import API route answers 403 with code: \"cloud managed\" . Export stays available subject to your current access and the export fidelity report. Self-hosted instances keep the full import surface. The Export page",
    "audience": "company-administrators",
    "maturity": "preview",
    "applicableProductVersions": [
      "V10"
    ],
    "locale": "en",
    "lastVerifiedAt": "2026-10-24"
  }
];
