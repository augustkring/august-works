// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  hireAgentCapabilitySchema,
  type HireAgentCapability,
} from "@paperclipai/shared";
import { HireDeclaredAccess } from "./HireDeclaredAccess";
import "../i18n";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const capability = hireAgentCapabilitySchema.parse({
  key: "research",
  versionId: "10000000-0000-4000-8000-000000000001",
  version: "1.0.0",
  name: "Research",
  category: "Research",
  outcome: "Prepare reviewed research",
  requiredKnowledge: [],
  requiredConnections: [],
  limits: [],
  actionClasses: ["internal_draft"],
  declaredAccess: {
    maximumRisk: "C1",
    optionalConnections: ["Optional app"],
    memoryPolicy: "source_governed",
    humanApproval: "before_material_action",
    supervision: "bounded_native",
    verification: "independent_native",
    sandboxAssurance: "qualified_managed",
    runtimeProviders: ["paperclip_native"],
    scopeAssessment: "unavailable",
    authorityEffect: "none",
  },
});
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function render(value: HireAgentCapability | null) {
  await act(async () => root.render(<HireDeclaredAccess capability={value} />));
}

it("distinguishes declared managed requirements from a qualified environment, granted scopes or a verified result", async () => {
  await render(capability);
  expect(container.textContent).toContain("does not grant access");
  expect(container.textContent).toContain(
    "does not establish that one is available",
  );
  expect(container.textContent).toContain("scopes have not been assessed");
  expect(container.textContent).toContain(
    "No representative result is established",
  );
  expect(container.textContent).toContain("Optional app");
  expect(container.querySelector("button")).toBeNull();
  expect(container.querySelector("a")).toBeNull();
});
it("withdraws the old declaration while the current Native capability is being checked", async () => {
  await render(capability);
  await render(null);
  expect(container.textContent).not.toContain("Optional app");
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    "declaration is unavailable",
  );
});
it("treats an absent old-owner declaration as unavailable rather than no access or no optional apps", async () => {
  const { declaredAccess: _, ...old } = capability;
  await render(old);
  expect(container.textContent).toContain("declaration is unavailable");
  expect(container.textContent).not.toContain(
    "No optional connected apps are declared",
  );
});
it("states customer responsibility and no persistent memory literally without changing access", async () => {
  await render({
    ...capability,
    declaredAccess: {
      ...capability.declaredAccess!,
      sandboxAssurance: "byo_customer_responsibility",
      memoryPolicy: "no_persistent_memory",
      optionalConnections: [],
    },
  });
  expect(container.textContent).toContain("responsible for its safeguards");
  expect(container.textContent).toContain("declares no persistent memory");
  expect(container.textContent).toContain(
    "No optional connected apps are declared",
  );
  expect(container.textContent).toContain("Human approval is required");
});
