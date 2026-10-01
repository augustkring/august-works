import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stripTypeScriptTypes } from "node:module";
import { parse } from "acorn";
import {
  buildLocalProcessSandboxSpawnTarget,
} from "@paperclipai/adapter-utils/local-process-sandbox";

const MAX_INPUT_BYTES = 256 * 1024;
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 3_000;
const MAX_TIMEOUT_MS = 10_000;
const MEMORY_LIMIT_BYTES = 384 * 1024 * 1024;
const PROCESS_LIMIT = 16;
const FILE_DESCRIPTOR_LIMIT = 64;
const CPU_SECONDS = 4;

const FORBIDDEN_IDENTIFIERS = new Set([
  "require",
  "process",
  "global",
  "globalThis",
  "Buffer",
  "console",
  "WebAssembly",
  "fetch",
  "WebSocket",
  "Worker",
  "SharedWorker",
  "SharedArrayBuffer",
  "Deno",
  "Bun",
  "eval",
  "Function",
]);

const FORBIDDEN_PROPERTIES = new Set([
  "__proto__",
  "prototype",
  "constructor",
]);

export type AutomationArtifactCodeRuntimeErrorCode =
  | "automation_artifact_code_runtime_unsupported_platform"
  | "automation_artifact_code_runtime_unavailable"
  | "automation_artifact_code_source_invalid"
  | "automation_artifact_code_import_denied"
  | "automation_artifact_code_capability_denied"
  | "automation_artifact_code_dependency_denied"
  | "automation_artifact_code_input_too_large"
  | "automation_artifact_code_output_too_large"
  | "automation_artifact_code_timeout"
  | "automation_artifact_code_execution_failed"
  | "automation_artifact_code_output_invalid";

export class AutomationArtifactCodeRuntimeError extends Error {
  readonly code: AutomationArtifactCodeRuntimeErrorCode;

  constructor(code: AutomationArtifactCodeRuntimeErrorCode, message: string) {
    super(message);
    this.name = "AutomationArtifactCodeRuntimeError";
    this.code = code;
  }
}

export interface AutomationArtifactCodeScanResult {
  transpiledSource: string;
  checks: Array<{ code: string; status: "passed"; detail: string | null }>;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function assertEmptyDependencyManifest(
  dependencyManifest: Record<string, unknown>,
): void {
  if (Object.keys(dependencyManifest).length > 0) {
    throw new AutomationArtifactCodeRuntimeError(
      "automation_artifact_code_dependency_denied",
      "Generated-code artifacts cannot install or declare runtime dependencies.",
    );
  }
}

interface PolicyAstNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

function asAstNode(value: unknown): PolicyAstNode | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    typeof (value as { type?: unknown }).type !== "string"
  ) {
    return null;
  }
  return value as PolicyAstNode;
}

function childAstNodes(node: PolicyAstNode): PolicyAstNode[] {
  const children: PolicyAstNode[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === "type" || key === "start" || key === "end") continue;
    if (Array.isArray(value)) {
      for (const entry of value) {
        const child = asAstNode(entry);
        if (child) children.push(child);
      }
      continue;
    }
    const child = asAstNode(value);
    if (child) children.push(child);
  }
  return children;
}

function staticStringExpression(node: PolicyAstNode | null): string | null {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (node.type === "BinaryExpression" && node.operator === "+") {
    const left = staticStringExpression(asAstNode(node.left));
    const right = staticStringExpression(asAstNode(node.right));
    return left === null || right === null ? null : left + right;
  }
  return null;
}

function identifierIsNonReferenceProperty(
  node: PolicyAstNode,
  parent: PolicyAstNode | null,
): boolean {
  if (!parent) return false;
  if (
    parent.type === "MemberExpression" &&
    parent.computed === false &&
    parent.property === node
  ) {
    return true;
  }
  if (
    (parent.type === "Property" ||
      parent.type === "MethodDefinition" ||
      parent.type === "PropertyDefinition") &&
    parent.computed === false &&
    parent.key === node
  ) {
    // Object shorthand such as { process } is still a reference to the
    // ambient identifier and must remain denied.
    return !(parent.type === "Property" && parent.shorthand === true);
  }
  return false;
}

function topLevelFunctionBindings(program: PolicyAstNode): Set<string> {
  const bindings = new Set<string>();
  const body = Array.isArray(program.body) ? program.body : [];
  for (const rawStatement of body) {
    const statement = asAstNode(rawStatement);
    if (!statement) continue;
    if (statement.type === "FunctionDeclaration") {
      const id = asAstNode(statement.id);
      if (id?.type === "Identifier" && typeof id.name === "string") {
        bindings.add(id.name);
      }
      continue;
    }
    if (statement.type !== "VariableDeclaration") continue;
    const declarations = Array.isArray(statement.declarations)
      ? statement.declarations
      : [];
    for (const rawDeclaration of declarations) {
      const declaration = asAstNode(rawDeclaration);
      const id = asAstNode(declaration?.id);
      const init = asAstNode(declaration?.init);
      if (
        id?.type === "Identifier" &&
        typeof id.name === "string" &&
        (init?.type === "ArrowFunctionExpression" ||
          init?.type === "FunctionExpression")
      ) {
        bindings.add(id.name);
      }
    }
  }
  return bindings;
}

function assertSourcePolicy(sourceCode: string): void {
  let program: PolicyAstNode;
  try {
    program = parse(sourceCode, {
      ecmaVersion: "latest",
      sourceType: "module",
    }) as unknown as PolicyAstNode;
  } catch {
    throw new AutomationArtifactCodeRuntimeError(
      "automation_artifact_code_source_invalid",
      "TypeScript source could not be parsed after safe type stripping.",
    );
  }

  const topLevelFunctions = topLevelFunctionBindings(program);
  let defaultExportCount = 0;

  const visit = (
    node: PolicyAstNode,
    parent: PolicyAstNode | null,
  ): void => {
    if (
      node.type === "ImportDeclaration" ||
      node.type === "ImportExpression" ||
      node.type === "ExportAllDeclaration" ||
      node.type === "ExportNamedDeclaration"
    ) {
      throw new AutomationArtifactCodeRuntimeError(
        "automation_artifact_code_import_denied",
        "Generated-code artifacts cannot import, dynamically import, or re-export modules.",
      );
    }

    if (node.type === "ExportDefaultDeclaration") {
      defaultExportCount += 1;
      const declaration = asAstNode(node.declaration);
      const inlineFunction =
        declaration?.type === "ArrowFunctionExpression" ||
        declaration?.type === "FunctionExpression" ||
        declaration?.type === "FunctionDeclaration";
      const boundFunction =
        declaration?.type === "Identifier" &&
        typeof declaration.name === "string" &&
        topLevelFunctions.has(declaration.name);
      if (!inlineFunction && !boundFunction) {
        throw new AutomationArtifactCodeRuntimeError(
          "automation_artifact_code_source_invalid",
          "The default export must be a function.",
        );
      }
    }

    if (
      node.type === "Identifier" &&
      typeof node.name === "string" &&
      FORBIDDEN_IDENTIFIERS.has(node.name) &&
      !identifierIsNonReferenceProperty(node, parent)
    ) {
      throw new AutomationArtifactCodeRuntimeError(
        "automation_artifact_code_capability_denied",
        `Generated-code artifact uses forbidden capability ${JSON.stringify(node.name)}.`,
      );
    }

    if (node.type === "MemberExpression") {
      const property = asAstNode(node.property);
      const staticProperty =
        node.computed === false &&
        property?.type === "Identifier" &&
        typeof property.name === "string"
          ? property.name
          : node.computed === true
            ? staticStringExpression(property)
            : null;
      if (staticProperty && FORBIDDEN_PROPERTIES.has(staticProperty)) {
        throw new AutomationArtifactCodeRuntimeError(
          "automation_artifact_code_capability_denied",
          `Generated-code artifact uses forbidden property ${JSON.stringify(staticProperty)}.`,
        );
      }
    }

    if (
      node.type === "MetaProperty" ||
      node.type === "WithStatement" ||
      node.type === "DebuggerStatement"
    ) {
      throw new AutomationArtifactCodeRuntimeError(
        "automation_artifact_code_capability_denied",
        `Generated-code artifact contains unsupported syntax ${JSON.stringify(node.type)}.`,
      );
    }

    for (const child of childAstNodes(node)) {
      visit(child, node);
    }
  };

  visit(program, null);

  if (defaultExportCount !== 1) {
    throw new AutomationArtifactCodeRuntimeError(
      "automation_artifact_code_source_invalid",
      "Generated TypeScript must define exactly one default-exported function.",
    );
  }
}

export function scanAndTranspileAutomationArtifactTypeScript(input: {
  sourceCode: string;
  dependencyManifest: Record<string, unknown>;
}): AutomationArtifactCodeScanResult {
  assertEmptyDependencyManifest(input.dependencyManifest);

  let transpiledSource: string;
  try {
    // Node 24+ strips erasable TypeScript syntax without loading a compiler
    // package at runtime. Non-erasable TS features fail closed here.
    transpiledSource = stripTypeScriptTypes(input.sourceCode, {
      mode: "strip",
    });
  } catch {
    throw new AutomationArtifactCodeRuntimeError(
      "automation_artifact_code_source_invalid",
      "TypeScript source contains unsupported or invalid syntax.",
    );
  }

  assertSourcePolicy(transpiledSource);

  return {
    transpiledSource,
    checks: [
      {
        code: "typescript_parse",
        status: "passed",
        detail: "TypeScript was safely stripped and parsed successfully.",
      },
      {
        code: "imports_denied",
        status: "passed",
        detail: "No runtime module imports, dynamic imports, or re-exports are present.",
      },
      {
        code: "ambient_capabilities_denied",
        status: "passed",
        detail: "Forbidden ambient process, network, code-generation, and prototype escape capabilities were not referenced.",
      },
      {
        code: "dependencies_empty",
        status: "passed",
        detail: "No runtime dependencies are declared.",
      },
    ],
  };
}

const RUNNER_SOURCE = `
import process from "node:process";
import { pathToFileURL } from "node:url";

let raw = "";
for await (const chunk of process.stdin) {
  raw += chunk.toString("utf8");
}
const write = process.stdout.write.bind(process.stdout);
const fail = (message) => {
  write(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
};
let input;
try {
  input = JSON.parse(raw);
} catch {
  fail("input_invalid");
}

for (const key of [
  "process",
  "Buffer",
  "console",
  "WebAssembly",
  "fetch",
  "WebSocket",
  "Worker",
  "SharedWorker",
  "SharedArrayBuffer",
]) {
  try {
    Object.defineProperty(globalThis, key, {
      value: undefined,
      writable: false,
      configurable: false,
      enumerable: false,
    });
  } catch {}
}

try {
  const module = await import(pathToFileURL(new URL("./artifact.mjs", import.meta.url).pathname).href);
  if (typeof module.default !== "function") fail("default_export_not_function");
  const output = await module.default(input);
  const json = JSON.stringify({ ok: true, output });
  if (typeof json !== "string") fail("output_not_json");
  write(json);
} catch {
  fail("artifact_execution_failed");
}
`;

interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  overflow: boolean;
}

async function runBoundedProcess(input: {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  stdin: string;
  timeoutMs: number;
}): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: Object.fromEntries(
        Object.entries(input.env).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      ),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let overflow = false;
    let settled = false;

    const finish = (result: Omit<ProcessResult, "stdout" | "stderr" | "overflow">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, stdout, stderr, overflow });
    };

    const append = (
      current: string,
      chunk: Buffer,
      maxBytes: number,
    ): { next: string; exceeded: boolean } => {
      const next = current + chunk.toString("utf8");
      if (byteLength(next) <= maxBytes) return { next, exceeded: false };
      return { next: next.slice(0, maxBytes), exceeded: true };
    };

    child.stdout.on("data", (chunk: Buffer) => {
      const result = append(stdout, chunk, MAX_OUTPUT_BYTES);
      stdout = result.next;
      if (result.exceeded && !overflow) {
        overflow = true;
        child.kill("SIGKILL");
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const result = append(stderr, chunk, MAX_STDERR_BYTES);
      stderr = result.next;
      if (result.exceeded && !overflow) {
        overflow = true;
        child.kill("SIGKILL");
      }
    });
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => {
      finish({ exitCode, signal, timedOut: false });
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ exitCode: null, signal: "SIGKILL", timedOut: true });
    }, input.timeoutMs);
    timer.unref?.();

    child.stdin.end(input.stdin);
  });
}

export async function executeAutomationArtifactTypeScriptSandbox(input: {
  sourceCode: string;
  dependencyManifest: Record<string, unknown>;
  value: unknown;
  timeoutMs?: number;
}): Promise<unknown> {
  if (process.platform !== "linux") {
    throw new AutomationArtifactCodeRuntimeError(
      "automation_artifact_code_runtime_unsupported_platform",
      "Generated-code Automation Artifacts require the qualified Linux sandbox runtime.",
    );
  }

  const serializedInput = JSON.stringify(input.value);
  if (
    typeof serializedInput !== "string" ||
    byteLength(serializedInput) > MAX_INPUT_BYTES
  ) {
    throw new AutomationArtifactCodeRuntimeError(
      "automation_artifact_code_input_too_large",
      "Automation Artifact input exceeds the sandbox input limit.",
    );
  }

  const scanned = scanAndTranspileAutomationArtifactTypeScript({
    sourceCode: input.sourceCode,
    dependencyManifest: input.dependencyManifest,
  });

  const timeoutMs = Math.max(
    100,
    Math.min(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS),
  );

  const workspaceDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "aw-artifact-runtime-"),
  );
  try {
    const artifactPath = path.join(workspaceDir, "artifact.mjs");
    const runnerPath = path.join(workspaceDir, "runner.mjs");
    await fs.writeFile(artifactPath, scanned.transpiledSource, {
      encoding: "utf8",
      mode: 0o400,
    });
    await fs.writeFile(runnerPath, RUNNER_SOURCE, {
      encoding: "utf8",
      mode: 0o400,
    });

    let target: Awaited<ReturnType<typeof buildLocalProcessSandboxSpawnTarget>>;
    try {
      target = await buildLocalProcessSandboxSpawnTarget({
        executable: process.execPath,
        args: [
          "--max-old-space-size=96",
          "--disallow-code-generation-from-strings",
          runnerPath,
        ],
        cwd: workspaceDir,
        options: {
          workspaceDir,
          filesystemScope: "workspace",
          networkScope: "deny",
        },
      });
    } catch {
      throw new AutomationArtifactCodeRuntimeError(
        "automation_artifact_code_runtime_unavailable",
        "Qualified Linux sandbox preparation is unavailable.",
      );
    }

    const prlimitArgs = [
      `--nproc=${PROCESS_LIMIT}`,
      `--cpu=${CPU_SECONDS}`,
      `--as=${MEMORY_LIMIT_BYTES}`,
      `--nofile=${FILE_DESCRIPTOR_LIMIT}`,
      "--",
      target.command,
      ...target.args,
    ];

    let result: ProcessResult;
    try {
      result = await runBoundedProcess({
        command: "prlimit",
        args: prlimitArgs,
        cwd: "/",
        env: {
          LANG: "C.UTF-8",
          LC_ALL: "C.UTF-8",
          TZ: "UTC",
          ...target.env,
        },
        stdin: serializedInput,
        timeoutMs,
      });
    } catch {
      throw new AutomationArtifactCodeRuntimeError(
        "automation_artifact_code_runtime_unavailable",
        "Qualified Linux sandbox launcher is unavailable.",
      );
    } finally {
      await target.cleanup?.();
    }

    if (result.timedOut) {
      throw new AutomationArtifactCodeRuntimeError(
        "automation_artifact_code_timeout",
        "Automation Artifact exceeded its wall-clock execution limit.",
      );
    }
    if (result.overflow) {
      throw new AutomationArtifactCodeRuntimeError(
        "automation_artifact_code_output_too_large",
        "Automation Artifact exceeded its output limit.",
      );
    }
    if (result.exitCode !== 0) {
      throw new AutomationArtifactCodeRuntimeError(
        "automation_artifact_code_execution_failed",
        "Automation Artifact sandbox execution failed.",
      );
    }

    let envelope: unknown;
    try {
      envelope = JSON.parse(result.stdout);
    } catch {
      throw new AutomationArtifactCodeRuntimeError(
        "automation_artifact_code_output_invalid",
        "Automation Artifact sandbox produced an invalid response.",
      );
    }
    if (
      typeof envelope !== "object" ||
      envelope === null ||
      Array.isArray(envelope) ||
      (envelope as Record<string, unknown>).ok !== true ||
      !Object.prototype.hasOwnProperty.call(envelope, "output")
    ) {
      throw new AutomationArtifactCodeRuntimeError(
        "automation_artifact_code_execution_failed",
        "Automation Artifact sandbox did not report a successful result.",
      );
    }
    return (envelope as Record<string, unknown>).output;
  } finally {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
}
