export const managedNativeBrowserCases = [
      { label: "feature flag disables an active turn and blocks idle sends and resets", cohort: "core", directApi: false,
        invalid: null, attachment: false, sourceUi: null, mode: null, featureFlag: true, repositorySelection: null },
      { label: "dedicated tool", cohort: "sidebarAndTool", directApi: false, invalid: null, attachment: false, sourceUi: null, mode: null, featureFlag: false, repositorySelection: null },
      { label: "direct API call", cohort: "core", directApi: true, invalid: null, attachment: false, sourceUi: null, mode: null, featureFlag: false, repositorySelection: null },
      { label: "first upload creates a chat without starting a run", cohort: "core", directApi: false, invalid: null, attachment: true, sourceUi: null, mode: null, featureFlag: false, repositorySelection: null },
      { label: "source loss hides cached history after reload", cohort: "core", directApi: false, invalid: null, attachment: false, sourceUi: "reload", mode: null, featureFlag: false, repositorySelection: null },
      { label: "live source denial hides history without reload", cohort: "core", directApi: false, invalid: null, attachment: false, sourceUi: "live", mode: null, featureFlag: false, repositorySelection: null },
      { label: "unknown repository ID", cohort: "sourceAndInvalid", directApi: false, invalid: (name: string, key: string) => ({
        name, repositoryIds: ["987654321"], idempotencyKey: key,
      }), attachment: false, sourceUi: null, mode: null, featureFlag: false, repositorySelection: null },
      { label: "credential-bearing repository URL", cohort: "sourceAndInvalid", directApi: false, invalid: (name: string, key: string) => ({
        name, repositoryUrls: ["https://user:password@github.com/org/repo"], idempotencyKey: key,
      }), attachment: false, sourceUi: null, mode: null, featureFlag: false, repositorySelection: null },
      { label: "conflicting workspace and repository URL", cohort: "sourceAndInvalid", directApi: false, invalid: (name: string, key: string) => ({
        name, repositoryUrls: ["https://github.com/org/repo"],
        workspace: { name: "Conflicting", repoUrl: "https://github.com/org/repo" }, idempotencyKey: key,
      }), attachment: false, sourceUi: null, mode: null, featureFlag: false, repositorySelection: null },
      { label: "Ask mode denies project mutation", cohort: "sourceAndInvalid", directApi: false, invalid: null, attachment: false, sourceUi: null, mode: "ask" as const, featureFlag: false, repositorySelection: null },
      { label: "Plan mode denies project mutation and revises plan", cohort: "repositoryAndFirstOpen", directApi: false, invalid: null, attachment: false, sourceUi: null, mode: "planning" as const, featureFlag: false, repositorySelection: null },
      { label: "authorized repository selection: one ID", cohort: "repositoryAndFirstOpen", directApi: false, invalid: null, attachment: false,
        sourceUi: null, mode: null, featureFlag: false, repositorySelection: { ids: ["101"], urls: [] } },
      { label: "authorized repository selection: two IDs", cohort: "repositoryAndFirstOpen", directApi: false, invalid: null, attachment: false,
        sourceUi: null, mode: null, featureFlag: false, repositorySelection: { ids: ["101", "102"], urls: [] } },
      { label: "authorized repository selection: one ID plus URLs", cohort: "repositoryAndFirstOpen", directApi: false, invalid: null, attachment: false,
        sourceUi: null, mode: null, featureFlag: false, repositorySelection: { ids: ["101"], urls: [
          "https://github.com/chat-fixture/frontend", "https://github.com/octocat/Hello-World",
        ] } },
      { label: "read-only first open and concurrent first sends", cohort: "repositoryAndFirstOpen", directApi: false, invalid: null,
        attachment: false, sourceUi: null, mode: null, featureFlag: false, repositorySelection: null },
      { label: "shared history loads older messages without replacing the latest turn", cohort: "historyAndReset", directApi: false,
        invalid: null, attachment: false, sourceUi: null, mode: null, featureFlag: false, repositorySelection: null },
      { label: "Stop then queued /new resets unpause the conversation without losing history", cohort: "historyAndReset", directApi: false,
        invalid: null, attachment: false, sourceUi: null, mode: null, featureFlag: false, repositorySelection: null },
      { label: "split handoff commits plans before execution without chat children", cohort: "governedHandoffs", directApi: false,
        invalid: null, attachment: false, sourceUi: null, mode: null, featureFlag: false, repositorySelection: null },
      { label: "plan approval hands the preserved revision to an assigned task", cohort: "governedHandoffs", directApi: false,
        invalid: null, attachment: false, sourceUi: null, mode: "planning" as const, featureFlag: false, repositorySelection: null },
      { label: "shared questions resume and existing project reuse creates no project card", cohort: "governedHandoffs", directApi: false,
        invalid: null, attachment: false, sourceUi: null, mode: null, featureFlag: false, repositorySelection: null },
      { label: "owner recovers after source visibility loss while metric lineage survives", cohort: "sourceAndInvalid", directApi: false,
        invalid: null, attachment: false, sourceUi: "owner_recovery", mode: null, featureFlag: false, repositorySelection: null },
      { label: "sidebar discovery, stars, recent Agents, configuration links, drafts, and background Native activity", cohort: "sidebarAndTool", directApi: false,
        invalid: null, attachment: false, sourceUi: null, mode: null, featureFlag: false, repositorySelection: null },
    ];


export const managedNativeBrowserCohortNames = [
  "core",
  "sourceAndInvalid",
  "repositoryAndFirstOpen",
  "historyAndReset",
  "governedHandoffs",
  "sidebarAndTool",
] as const;

export type ManagedNativeBrowserCohort = typeof managedNativeBrowserCohortNames[number];

export function managedNativeBrowserCasesForCohort(cohort: ManagedNativeBrowserCohort) {
  const selected = managedNativeBrowserCases.filter(scenario => scenario.cohort === cohort);
  if (!selected.length) throw new Error(`managed_browser_cohort_empty_${cohort}`);
  return selected;
}
