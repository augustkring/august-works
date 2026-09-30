import { describe, expect, it } from "vitest";

import {
  AutomationArtifactCodeRuntimeError,
  scanAndTranspileAutomationArtifactTypeScript,
} from "./automation-artifact-code-runtime.js";

describe("Automation Artifact generated-code policy", () => {
  it("accepts a dependency-free default-exported pure function", () => {
    const result = scanAndTranspileAutomationArtifactTypeScript({
      sourceCode:
        "export default (input: { value: number }) => ({ value: input.value + 1 });",
      dependencyManifest: {},
    });

    expect(result.transpiledSource).toContain("export default");
    expect(result.checks.map((check) => check.code)).toEqual(
      expect.arrayContaining([
        "typescript_parse",
        "imports_denied",
        "ambient_capabilities_denied",
        "dependencies_empty",
      ]),
    );
  });

  it.each([
    {
      label: "module import",
      source: 'import fs from "node:fs"; export default () => fs.readdirSync(".");',
      code: "automation_artifact_code_import_denied",
    },
    {
      label: "dynamic import",
      source:
        'export default async () => (await import("node:fs")).readdirSync(".");',
      code: "automation_artifact_code_import_denied",
    },
    {
      label: "ambient process",
      source: "export default () => process.env;",
      code: "automation_artifact_code_capability_denied",
    },
    {
      label: "ambient console",
      source: 'export default () => { console.log("leak"); return 1; };',
      code: "automation_artifact_code_capability_denied",
    },
    {
      label: "WebAssembly",
      source: "export default () => WebAssembly;",
      code: "automation_artifact_code_capability_denied",
    },
    {
      label: "constructor escape",
      source:
        'export default () => ({}).constructor.constructor("return 1")();',
      code: "automation_artifact_code_capability_denied",
    },
    {
      label: "computed constructor escape",
      source:
        'export default () => ({}["con" + "structor"]["con" + "structor"])("return 1")();',
      code: "automation_artifact_code_capability_denied",
    },
    {
      label: "computed prototype access",
      source:
        'export default () => ([]["pro" + "totype"]);',
      code: "automation_artifact_code_capability_denied",
    },
  ])("rejects $label", ({ source, code }) => {
    expect(() =>
      scanAndTranspileAutomationArtifactTypeScript({
        sourceCode: source,
        dependencyManifest: {},
      }),
    ).toThrowError(
      expect.objectContaining<Partial<AutomationArtifactCodeRuntimeError>>({
        code,
      }),
    );
  });

  it("rejects runtime dependency declarations", () => {
    expect(() =>
      scanAndTranspileAutomationArtifactTypeScript({
        sourceCode: "export default (input: unknown) => input;",
        dependencyManifest: { lodash: "4.17.21" },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<AutomationArtifactCodeRuntimeError>>({
        code: "automation_artifact_code_dependency_denied",
      }),
    );
  });

  it("requires exactly one default-exported function", () => {
    expect(() =>
      scanAndTranspileAutomationArtifactTypeScript({
        sourceCode: "const value = 1;",
        dependencyManifest: {},
      }),
    ).toThrowError(
      expect.objectContaining<Partial<AutomationArtifactCodeRuntimeError>>({
        code: "automation_artifact_code_source_invalid",
      }),
    );
  });
});
