// Extract V4 values verbatim into the existing design token system.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const files = [
  "ui/src/components/routine-sections/editable-sections.production.tsx",
  "ui/src/components/routine-sections/editable-sections.tsx",
  "ui/src/components/workflows/WorkflowDataSelector.tsx",
  "ui/src/components/workflows/WorkflowOptimizerSuggestions.tsx",
  "ui/src/pages/Foundation.tsx", "ui/src/pages/Memory.tsx",
  "ui/src/pages/PipelineSettings.tsx", "ui/src/pages/Routines.tsx",
  "ui/src/pages/WorkflowBuilder.tsx", "ui/src/pages/WorkflowRun.tsx", "ui/src/pages/WorkflowRuns.tsx",
];
const replacements = new Map([
  ["text-[10px]", "text-(length:--text-nano)"], ["text-[11px]", "text-(length:--text-micro)"],
  ["w-[112px]", "w-(--sz-112px)"], ["w-[118px]", "w-(--sz-118px)"],
  ...[240, 260, 320, 440, 560].map((value) => [`min-h-[${value}px]`, `min-h-(--sz-${value}px)`]),
  ["grid-cols-[190px_270px_minmax(0,1fr)]", "grid-cols-(--gtc-foundation-browser)"],
  ["grid-cols-[170px_minmax(0,1fr)]", "grid-cols-(--gtc-foundation-editor)"],
  ["grid-cols-[220px_minmax(0,1fr)_300px]", "grid-cols-(--gtc-workflow-builder)"],
  ["grid-cols-[minmax(0,1fr)_auto]", "grid-cols-(--gtc-13)"],
]);
for (const file of files) {
  const path = resolve(root, file);
  const before = readFileSync(path, "utf8");
  let after = before;
  for (const [from, to] of replacements) after = after.replaceAll(from, to);
  if (after !== before) writeFileSync(path, after);
}
