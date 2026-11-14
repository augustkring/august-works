import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db, projectWorkspaces } from "@paperclipai/db";
const owner = vi.hoisted(() => ({ capture: vi.fn(), current: vi.fn(), redact: vi.fn() }));
vi.mock("../native-direct-input.js", () => ({ captureNativeProjectSource: owner.capture,
  assertNativeProjectSourceCurrent: owner.current }));
vi.mock("../run-secret-redaction.js", () => ({ createRunSecretRedactionRegistry: () => ({ redactForIssue: owner.redact }) }));
import { captureNativeSelectedProjectSource, formatNativeProjectRepositoryAppendix, prepareNativeProjectRepositoryPrompt } from "./native-project-repository-source.js";
import { buildNativeBootstrapSourceSet } from "./native-execution-input.js";

// These component tests mock current DB/source owners. They do not qualify
// a Native Run, Git checkout, physical sandbox or nested repository Git state.
describe("Project repository renderer source components", () => {
  const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
  const companyId = randomUUID(), projectId = randomUUID(), issueId = randomUUID(), runId = randomUUID(),
    agentId = randomUUID(), responsibleUserId = randomUUID(), selectedWorkspaceId = randomUUID();
  const policy = { issueIds: [], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] };
  let home: string;
  let input: Parameters<typeof prepareNativeProjectRepositoryPrompt>[0];
  let selection: Record<string, unknown>;
  let capture: Awaited<ReturnType<typeof import("../native-direct-input.js").captureNativeProjectSource>>;
  let captureBaseline: typeof capture;
  beforeEach(async () => {
    vi.clearAllMocks();
    home = await realpath(await mkdtemp(path.join(tmpdir(), "native-project-source-component-")));
    const cwd = path.join(home, "task"), repoA = path.join(cwd, ".paperclip-repositories", "repo-a"),
      repoB = path.join(cwd, ".paperclip-repositories", "repo-b");
    await mkdir(repoA, { recursive: true }); await mkdir(repoB, { recursive: true }); await mkdir(path.join(home, "neighbor"));
    const ids = [selectedWorkspaceId, randomUUID(), randomUUID()];
    const rows = ids.map((id, index) => ({ id, companyId, projectId, repoUrl: `https://example.invalid/repo-${index}.git`,
      repoRef: "main", cwd, updatedAt: new Date("2026-11-03T00:00:00.000Z") })) as Array<typeof projectWorkspaces.$inferSelect>;
    capture = { input: { kind: "project", projectId, sourceVersion: "2026-11-03T00:00:00.000Z", contentHash: "a".repeat(64) },
      payloadSourceSnapshot: { version: 1, owner: { kind: "project", companyId, id: projectId, contentHash: "b".repeat(64) },
        policy, inputs: rows.map(row => ({ kind: "project_workspace", projectId, workspaceId: row.id,
          sourceVersion: row.updatedAt.toISOString(), contentHash: "c".repeat(64) })), digest: "d".repeat(64) }, workspaces: structuredClone(rows) };
    captureBaseline = structuredClone(capture);
    selection = { projectId, projectWorkspaceId: selectedWorkspaceId, assigneeAgentId: agentId, executionRunId: runId,
      runAgentId: agentId, responsibleUserId, status: "running" };
    const db = { select: () => ({ from: () => ({ innerJoin: () => ({ where: () => ({ limit: async () => [selection] }) }) }) }) } as unknown as Db;
    input = { db, companyId, projectId, issueId, runId, agentId, responsibleUserId, selectedWorkspaceId, cwd,
      repositoryRows: rows, repositories: [{ workspaceId: ids[1]!, cwd: repoA, repoUrl: rows[1]!.repoUrl!, repoRef: "main" },
        { workspaceId: ids[2]!, cwd: repoB, repoUrl: rows[2]!.repoUrl!, repoRef: "main" }], baseMarkdown: "Actual selected Task body.",
      baseSourceMap: { version: 1, renderedMarkdownDigest: hash("Actual selected Task body."), renderedMarkdownLength: 26,
        references: [{ kind: "task", id: issueId }] } };
    input.baseSourceMap!.renderedMarkdownLength = input.baseMarkdown.length;
    owner.capture.mockResolvedValue(capture); owner.current.mockResolvedValue(undefined);
    owner.redact.mockImplementation(async (_company, _issue, value) => value);
  });
  afterEach(async () => { await rm(home, { recursive: true, force: true }); vi.unstubAllEnvs(); });
  const compose = (result: Awaited<ReturnType<typeof prepareNativeProjectRepositoryPrompt>>) => buildNativeBootstrapSourceSet({
    companyId, runId, agentId, issueId, renderedMarkdown: result.taskPrompt,
    renderedMarkdownDigest: result.sourceMap?.renderedMarkdownDigest ?? null, references: result.sourceMap?.references ?? null,
    candidates: [{ kind: "task", id: issueId, input: { kind: "task", issueId, sourceVersion: "1", contentHash: "e".repeat(64) },
      payloadSourceSnapshot: { version: 1, owner: { kind: "issue", companyId, id: issueId, contentHash: "f".repeat(64) },
        policy, inputs: [], digest: "a".repeat(64) } }, ...(result.candidate ? [result.candidate] : [])],
    runtimeInputs: [], contextManifestIds: [], rolePackInputs: [], unsupportedInputPresent: !result.candidate });

  it("composes the exact final renderer bytes and every actual materializer path with the current Project owner", async () => {
    const result = await prepareNativeProjectRepositoryPrompt(input);
    const appendix = formatNativeProjectRepositoryAppendix(input.repositories.map(repo => path.relative(input.cwd, repo.cwd)));
    expect(result.taskPrompt).toBe(`${input.baseMarkdown}\n\n${appendix}`);
    expect(result.sourceMap?.renderedMarkdownDigest).toBe(hash(result.taskPrompt));
    expect(result.sourceMap?.renderedMarkdownLength).toBe(result.taskPrompt.length);
    expect(result.sourceMap?.references).toEqual([{ kind: "task", id: issueId }, { kind: "project", id: projectId }]);
    expect(owner.redact).toHaveBeenCalledWith(companyId, issueId, { baseMarkdown: input.baseMarkdown, appendixMarkdown: appendix });
    expect(owner.current).toHaveBeenCalledWith(input.db, { companyId, actor: { type: "board", source: "session", userId: responsibleUserId }, source: capture.input });
    expect(compose(result)?.inputs).toContainEqual(capture.input);
    for (const pin of capture.payloadSourceSnapshot.inputs) expect(compose(result)?.inputs).toContainEqual(pin);
  });
  it("does not borrow a base source map for a different or missing selected rendition", async () => {
    input.baseSourceMap!.renderedMarkdownDigest = hash("different body");
    expect((await prepareNativeProjectRepositoryPrompt(input)).candidate).toBeNull();
    input.baseSourceMap = null; expect((await prepareNativeProjectRepositoryPrompt(input)).sourceMap).toBeNull();
    expect(owner.capture).not.toHaveBeenCalled();
  });
  it("retains actual redacted bytes but leaves changed base or displayed appendix paths unqualified", async () => {
    owner.redact.mockImplementation(async (_c, _i, value) => ({ ...value, baseMarkdown: "redacted Task body" }));
    const base = await prepareNativeProjectRepositoryPrompt(input); expect(base.taskPrompt).toContain("redacted Task body"); expect(base.candidate).toBeNull();
    owner.redact.mockImplementation(async (_c, _i, value) => ({ ...value, appendixMarkdown: "redacted appendix" }));
    const appendix = await prepareNativeProjectRepositoryPrompt(input); expect(appendix.taskPrompt).toContain("redacted appendix"); expect(appendix.candidate).toBeNull();
  });
  it("keeps an empty appendix out of Project source qualification", async () => {
    input.repositories = []; const result = await prepareNativeProjectRepositoryPrompt(input);
    expect(formatNativeProjectRepositoryAppendix([])).toBeNull(); expect(result.taskPrompt).toBe(input.baseMarkdown);
    expect(result.candidate).toBeNull(); expect(owner.capture).not.toHaveBeenCalled();
  });
  it("denies changed or foreign Task, Run, Agent, Human and selected Project/workspace bindings", async () => {
    const original = { ...selection };
    for (const key of ["projectId", "projectWorkspaceId", "assigneeAgentId", "executionRunId", "runAgentId", "responsibleUserId", "status"]) {
      selection = { ...original, [key]: "changed" }; expect((await prepareNativeProjectRepositoryPrompt(input)).candidate).toBeNull();
    }
    expect(owner.capture).not.toHaveBeenCalled();
  });
  it("denies stale, missing or foreign workspace materialization rows", async () => {
    capture.workspaces[1]!.updatedAt = new Date("2026-11-03T00:00:01.000Z");
    expect((await prepareNativeProjectRepositoryPrompt(input)).candidate).toBeNull();
    capture.workspaces = []; expect((await prepareNativeProjectRepositoryPrompt(input)).candidate).toBeNull();
  });
  it("requires every displayed repository to have its exact current workspace and repo/ref", async () => {
    input.repositories[1]!.repoRef = "other"; expect((await prepareNativeProjectRepositoryPrompt(input)).candidate).toBeNull();
    input.repositories[1]!.repoRef = "main"; input.repositories[1]!.workspaceId = randomUUID();
    expect((await prepareNativeProjectRepositoryPrompt(input)).candidate).toBeNull();
  });
  it("denies repeated workspace identities and displayed paths", async () => {
    input.repositories[1]!.workspaceId = input.repositories[0]!.workspaceId;
    expect((await prepareNativeProjectRepositoryPrompt(input)).candidate).toBeNull();
    input.repositories[1]!.workspaceId = capture.workspaces[2]!.id;
    input.repositories[1]!.cwd = input.repositories[0]!.cwd;
    expect((await prepareNativeProjectRepositoryPrompt(input)).candidate).toBeNull();
  });
  it("denies an outside root and a real symlink escape for any displayed path", async () => {
    const repo = input.repositories[1]!, original = repo.cwd; repo.cwd = path.join(home, "neighbor");
    expect((await prepareNativeProjectRepositoryPrompt(input)).candidate).toBeNull();
    repo.cwd = original; await rm(original, { recursive: true }); await symlink(path.join(home, "neighbor"), original);
    expect((await prepareNativeProjectRepositoryPrompt(input)).candidate).toBeNull();
  });
  it("preserves current Project source owner rejection and final Task currentness", async () => {
    const failure = new Error("project_source_owner_changed"); owner.capture.mockRejectedValueOnce(failure);
    await expect(prepareNativeProjectRepositoryPrompt(input)).rejects.toBe(failure);
    owner.current.mockImplementation(async () => {
      if (owner.current.mock.calls.length === 2) selection = { ...selection, status: "failed" };
    });
    expect((await prepareNativeProjectRepositoryPrompt(input)).candidate).toBeNull();
    expect(owner.current).toHaveBeenCalledTimes(2);
  });
  it("captures the selected Project once for an anchor-only Project workspace", async () => {
    const result = await captureNativeSelectedProjectSource({ db: input.db, companyId, runId, agentId, responsibleUserId,
      issueId, projectId, selectedWorkspaceId, repositoryRows: capture.workspaces });
    expect(result?.input).toEqual(capture.input);
    expect(result?.payloadSourceSnapshot.inputs).toContainEqual({ kind: "project_workspace", projectId, workspaceId: selectedWorkspaceId,
      sourceVersion: capture.workspaces[0]!.updatedAt.toISOString(), contentHash: "c".repeat(64) });
    expect(owner.capture).toHaveBeenCalledTimes(1);
    expect(owner.current).toHaveBeenCalledTimes(1);
  });
  it("revalidates and reuses an existing appendix candidate without a second capture", async () => {
    const appendix = await prepareNativeProjectRepositoryPrompt(input);
    expect(appendix.candidate).not.toBeNull();
    owner.capture.mockClear(); owner.current.mockClear();
    const reused = await captureNativeSelectedProjectSource({ db: input.db, companyId, runId, agentId, responsibleUserId,
      issueId, projectId, selectedWorkspaceId, repositoryRows: capture.workspaces, existingCandidate: appendix.candidate });
    expect(reused).toEqual(appendix.candidate);
    expect(owner.capture).not.toHaveBeenCalled();
    expect(owner.current).toHaveBeenCalledTimes(1);
  });
  it("rejects changed Task selection before capture and reassignment during capture", async () => {
    selection = { ...selection, assigneeAgentId: randomUUID() };
    expect(await captureNativeSelectedProjectSource({ db: input.db, companyId, runId, agentId, responsibleUserId,
      issueId, projectId, selectedWorkspaceId, repositoryRows: capture.workspaces })).toBeNull();
    expect(owner.capture).not.toHaveBeenCalled();
    selection = { projectId, projectWorkspaceId: selectedWorkspaceId, assigneeAgentId: agentId, executionRunId: runId,
      runAgentId: agentId, responsibleUserId, status: "running" };
    owner.capture.mockImplementationOnce(async () => { selection = { ...selection, responsibleUserId: randomUUID() }; return capture; });
    expect(await captureNativeSelectedProjectSource({ db: input.db, companyId, runId, agentId, responsibleUserId,
      issueId, projectId, selectedWorkspaceId, repositoryRows: capture.workspaces })).toBeNull();
  });
  it.each([
    ["selected workspace row", (value: typeof capture) => { value.workspaces[0]!.projectId = randomUUID(); }],
    ["sealed workspace pin", (value: typeof capture) => { value.payloadSourceSnapshot.inputs = []; }],
    ["snapshot company", (value: typeof capture) => { value.payloadSourceSnapshot.owner.companyId = randomUUID(); }],
  ])("rejects an independently malformed %s after a valid source capture", async (_label, mutate) => {
    const malformed = structuredClone(captureBaseline);
    mutate(malformed);
    owner.capture.mockResolvedValue(malformed);
    expect(await captureNativeSelectedProjectSource({ db: input.db, companyId, runId, agentId, responsibleUserId,
      issueId, projectId, selectedWorkspaceId, repositoryRows: captureBaseline.workspaces })).toBeNull();
    expect(owner.capture).toHaveBeenCalledTimes(1);
    expect(owner.current).not.toHaveBeenCalled();
  });
  it("does not capture when the responsible Human is missing", async () => {
    expect(await captureNativeSelectedProjectSource({ db: input.db, companyId, runId, agentId, responsibleUserId: null,
      issueId, projectId, selectedWorkspaceId, repositoryRows: capture.workspaces })).toBeNull();
    expect(owner.capture).not.toHaveBeenCalled();
  });
  it("the actual builder refuses missing or wrong Project snapshot owner/reference", async () => {
    const result = await prepareNativeProjectRepositoryPrompt(input); expect(compose(result)).not.toBeNull();
    expect(compose({ ...result, candidate: null })).toBeNull();
    const broken = structuredClone(result); (broken.candidate!.payloadSourceSnapshot as { owner: { id: string } }).owner.id = randomUUID();
    expect(compose(broken)).toBeNull();
  });
});
