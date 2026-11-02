import { createHash } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { JsonReporter } from "vitest/reporters";

const escapeData = value => String(value).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escapeProperty = value => escapeData(value).replace(/:/g, "%3A").replace(/,/g, "%2C");
const states = new Set(["passed", "failed", "skipped", "pending", "queued"]);
function atomicJson(file, value) {
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  renameSync(temporary, file);
}
export function moduleObservation(module, repoRoot) {
  const relative = path.relative(repoRoot, module.moduleId).replaceAll(path.sep, "/");
  const safeFile = !relative.startsWith("../") && !path.isAbsolute(relative) && !relative.includes("\0")
    ? relative.replace(/[^a-zA-Z0-9_./@-]/g, "_").slice(0, 240) : "external-module";
  const counts = { passed: 0, failed: 0, skipped: 0, pending: 0, unknown: 0 };
  const failures = [];
  for (const test of module.children.allTests()) {
    const state = test.result().state;
    counts[Object.hasOwn(counts, state) ? state : "unknown"]++;
    if (state === "failed" && failures.length < 5)
      failures.push(String(test.fullName).replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 160));
  }
  const state = module.state();
  return { file: safeFile, state: states.has(state) ? state : "unknown", counts, failedCaseNames: failures,
    failedCaseNamesTruncated: counts.failed > failures.length, processExit: "pending" };
}
export function moduleNotice(observation, artifact) {
  const message = `module=${observation.state}; module hooks ${observation.state === "passed" ? "complete" : "see module result (may fail before hooks)"}; processExit=pending; cases=${JSON.stringify(observation.counts)}; artifact=${artifact}; failedCases=${observation.failedCaseNames.join(" | ")}${observation.failedCaseNamesTruncated ? " [truncated]" : ""}`;
  return `::notice file=${escapeProperty(observation.file)},title=Vitest module result only::${escapeData(message.slice(0, 4096))}`;
}

export default class ModuleResultsReporter {
  notices = 0;
  truncated = false;
  onInit(ctx) {
    this.ctx = ctx;
    this.directory = process.env.PAPERCLIP_VITEST_INVOCATION_REPORT_DIR;
    this.repoRoot = process.env.PAPERCLIP_VITEST_REPORT_REPO_ROOT;
    const budget = Number(process.env.PAPERCLIP_VITEST_NOTICE_BUDGET);
    if (!this.directory || !path.isAbsolute(this.directory) || !this.repoRoot || !path.isAbsolute(this.repoRoot) ||
        !Number.isSafeInteger(budget) || budget < 0 || budget > 20)
      throw new Error("Invalid optional Vitest reporting configuration");
    this.budget = budget;
    mkdirSync(this.directory, { recursive: true });
    atomicJson(path.join(this.directory, "notice-count.json"), { count: 0 });
  }
  onTestRunStart(specifications) {
    atomicJson(path.join(this.directory, "run-start.json"), {
      modules: specifications.map(specification => ({ moduleId: specification.moduleId, project: specification.project.name })),
      processExit: "pending",
    });
  }
  async onTestModuleEnd(module) {
    const id = createHash("sha256").update(JSON.stringify([module.project.name, module.moduleId])).digest("hex");
    const destination = path.join(this.directory, `${id}.json`);
    const temporary = `${destination}.tmp`;
    // Native assertion/module errors and statuses are preserved verbatim.
    // A fresh instance avoids sharing mutable output paths between modules.
    const reporter = new JsonReporter({ outputFile: temporary, filterMeta: () => false });
    reporter.onInit(this.ctx);
    await reporter.onTestRunEnd([module]);
    renameSync(temporary, destination);
    const observation = moduleObservation(module, this.repoRoot);
    // Native JSON alone can label pending/unfinished cases misleadingly. Keep
    // the actual public module state and the still-pending process boundary.
    atomicJson(path.join(this.directory, `${id}.lifecycle.json`), observation);
    if (this.notices < this.budget - 1) {
      this.notices++;
      atomicJson(path.join(this.directory, "notice-count.json"), { count: this.notices });
      console.log(moduleNotice(observation, `${id}.json`));
    } else if (!this.truncated && this.notices < this.budget) {
      this.truncated = true; this.notices++;
      atomicJson(path.join(this.directory, "notice-count.json"), { count: this.notices });
      console.log("::notice title=Vitest result notices truncated::Further module notices omitted; full case results remain in the artifact. No process pass is implied.");
    }
  }
  onTestRunEnd(modules, unhandledErrors, reason) {
    atomicJson(path.join(this.directory, "run-end.json"), { reason, moduleCount: modules.length,
      unhandledErrorCount: unhandledErrors.length, processExit: "pending" });
    if (unhandledErrors.length) atomicJson(path.join(this.directory, "unhandled-errors.json"), unhandledErrors.map(error => {
      const message = typeof error.message === "string" ? error.message : "Serialized error without a message";
      const stack = typeof error.stack === "string" ? error.stack : "";
      return { name: typeof error.name === "string" ? error.name.slice(0, 160) : "UnknownError",
        message: message.slice(0, 4096), stack: stack.slice(0, 8192),
        truncated: message.length > 4096 || stack.length > 8192 };
    }));
  }
}
