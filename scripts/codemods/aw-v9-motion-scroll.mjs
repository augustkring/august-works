import { readFileSync, writeFileSync } from "node:fs";
import { relative, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const files = [
  "pages/BoardChat.tsx", "pages/IssueDetail.tsx", "pages/apps/app-detail/PermissionsPanel.tsx",
  "components/IssueChatThread.tsx", "components/DocumentAnnotationPanel.tsx",
  "components/ScrollToBottom.tsx", "components/IssueContinuationHandoff.tsx",
  "components/CommentThread.tsx", "components/IssuesList.tsx", "components/LegacyIssuesList.tsx",
  "components/issue-properties/IssuePropertiesArtifactsTab.tsx", "components/IssueDocumentsSection.tsx",
];
for (const name of files) {
  const path = resolve(root, "ui/src", name);
  const original = readFileSync(path, "utf8");
  // Existing explicitly guarded TaskMessageScroller and SidePanelTabs retain
  // their lifecycle logic. Wrap defaults and explicit smooth requests here.
  let updated = original.replace(/behavior: options\?\.behavior \?\? "smooth"/g,
    "behavior: preferredScrollBehavior(options?.behavior)")
    .replace(/behavior: "smooth"/g, "behavior: preferredScrollBehavior()")
    .replace(/behavior: ScrollBehavior = "smooth"/g, "behavior: ScrollBehavior = preferredScrollBehavior()")
    .replace(/scrollIntoView\(\{ behavior, block:/g, "scrollIntoView({ behavior: preferredScrollBehavior(behavior), block:");
  if (updated === original) continue;
  let module = relative(dirname(path), resolve(root, "ui/src/lib/scroll-behavior")).replaceAll("\\", "/");
  if (!module.startsWith(".")) module = `./${module}`;
  if (!updated.includes('import { preferredScrollBehavior }'))
    updated = `import { preferredScrollBehavior } from ${JSON.stringify(module)};\n${updated}`;
  writeFileSync(path, updated);
}
