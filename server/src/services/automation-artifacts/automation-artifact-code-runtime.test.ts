import { getArtifactSandboxTestSupport } from "../../__tests__/helpers/artifact-sandbox.js";
import { describe, expect, it } from "vitest";

import {
  AutomationArtifactCodeRuntimeError,
  executeAutomationArtifactTypeScriptSandbox,
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
      label: "external ArrayBuffer allocation",
      source:
        "export default () => new ArrayBuffer(512 * 1024 * 1024);",
      code: "automation_artifact_code_capability_denied",
    },
    {
      label: "TextEncoder native backing store",
      source:
        "export default () => new TextEncoder().encode('x'.repeat(1024));",
      code: "automation_artifact_code_capability_denied",
    },
    {
      label: "Response body native backing store",
      source:
        "export default () => new Response('x'.repeat(1024));",
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
  ] as const)("rejects $label", ({ source, code }) => {
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

  it("accepts the native compiler's explicitly empty dependency metadata", () => {
    expect(() => scanAndTranspileAutomationArtifactTypeScript({
      sourceCode: "export default (input: unknown) => input;",
      dependencyManifest: { packages: [], capabilityRefs: [] },
    })).not.toThrow();
  });
  it.each([{ lodash: "4.17.21" }, { packages: ["lodash"], capabilityRefs: [] },
    { packages: [], capabilityRefs: ["tool:private"] }, { packages: [], unknown: [] }])("rejects runtime dependency declarations: %j", dependencyManifest => {
    expect(() =>
      scanAndTranspileAutomationArtifactTypeScript({
        sourceCode: "export default (input: unknown) => input;",
        dependencyManifest,
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


const sandboxSupport = await getArtifactSandboxTestSupport();
const qualifiedLinuxSandbox = sandboxSupport.supported;

const describeQualifiedSandbox = qualifiedLinuxSandbox
  ? describe
  : describe.skip;

describeQualifiedSandbox("Automation Artifact qualified TypeScript sandbox", () => {
  it("preserves deterministic explicit numeric computation in the native sandbox", async () => {
    expect(await executeAutomationArtifactTypeScriptSandbox({ sourceCode: "export default (input: { price: number, amount: number }) => ({ total: input.price * input.amount });", dependencyManifest: {}, value: { price: 4, amount: 3 }, deterministic: true })).toEqual({ total: 12 });
  });
  it.each(["Math.random()", "Math['random']()", "Date.now()", "performance.now()", "crypto.randomUUID()", "new Intl.DateTimeFormat().format()", "AbortSignal.timeout(1)"])("denies ambient randomness/clock in deterministic mode: %s", async expression => {
    await expect(executeAutomationArtifactTypeScriptSandbox({ sourceCode: `export default () => ({ value: ${expression} });`, dependencyManifest: {}, value: {}, deterministic: true })).rejects.toBeInstanceOf(AutomationArtifactCodeRuntimeError);
  });

  it(
    "starts Node under the resource limits and preserves large Unicode input/output",
    async () => {
      const text = "Sønderborg · 日本語 · 🙂 · ".repeat(6_000);
      const output = await executeAutomationArtifactTypeScriptSandbox({
        sourceCode:
          "export default (input: { text: string }) => ({ text: input.text });",
        dependencyManifest: {},
        value: { text },
        timeoutMs: 5_000,
      });

      expect(output).toEqual({ text });
    },
    15_000,
  );

  it(
    "terminates non-cooperative generated code at the wall-clock limit",
    async () => {
      await expect(
        executeAutomationArtifactTypeScriptSandbox({
          sourceCode: "export default () => { while (true) {} };",
          dependencyManifest: {},
          value: {},
          timeoutMs: 150,
        }),
      ).rejects.toMatchObject({
        code: "automation_artifact_code_timeout",
      });
    },
    15_000,
  );

  it(
    "fails closed when generated output exceeds the bounded stdout contract",
    async () => {
      await expect(
        executeAutomationArtifactTypeScriptSandbox({
          sourceCode:
            "export default () => ({ text: 'x'.repeat(300000) });",
          dependencyManifest: {},
          value: {},
          timeoutMs: 5_000,
        }),
      ).rejects.toMatchObject({
        code: "automation_artifact_code_output_too_large",
      });
    },
    15_000,
  );
});
