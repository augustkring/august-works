import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { and, eq } from "drizzle-orm";
import { heartbeatRuns, issues, type Db, type projectWorkspaces } from "@paperclipai/db";
import { captureNativeProjectSource, assertNativeProjectSourceCurrent } from "../native-direct-input.js";
import { nativePayloadSourceSnapshotSchema, type NativePayloadSourceInput, type NativePayloadSourceSnapshot } from "@paperclipai/shared";
import { createRunSecretRedactionRegistry } from "../run-secret-redaction.js";
import type { NativePreparedSourceCandidate, NativeRenderedSourceReference } from "./native-execution-input.js";

type NativeSelectedProjectSource = {
  kind: "project"; id: string;
  input: Extract<NativePayloadSourceInput, { kind: "project" }>;
  payloadSourceSnapshot: NativePayloadSourceSnapshot;
};

type Repository = { workspaceId: string; cwd: string; repoUrl: string; repoRef: string | null };
type RendererMap = { version: 1; renderedMarkdownDigest: string; renderedMarkdownLength: number;
  references: NativeRenderedSourceReference[] };
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** The existing appendix format has one owner for ordinary and Native callers. */
export function formatNativeProjectRepositoryAppendix(paths: readonly string[]): string | null {
  return paths.length > 0
    ? `## Project repositories\nThe task workspace also contains these editable Git repositories:\n${paths.map(repo => `- ${repo}`).join("\n")}`
    : null;
}

/** Capture or revalidate the current selected Project source for one live Task/Run
 * binding. An existing appendix candidate is reused without recapturing. */
export async function captureNativeSelectedProjectSource(input: {
  db: Db; companyId: string; runId: string; agentId: string; responsibleUserId: string | null;
  issueId: string; projectId: string; selectedWorkspaceId: string;
  repositoryRows: Array<typeof projectWorkspaces.$inferSelect>;
  existingCandidate?: NativePreparedSourceCandidate | null;
}): Promise<NativeSelectedProjectSource | null> {
  if (!input.responsibleUserId) return null;
  const assertTaskSelection = async () => {
    const [current] = await input.db.select({ projectId: issues.projectId, projectWorkspaceId: issues.projectWorkspaceId,
      assigneeAgentId: issues.assigneeAgentId, executionRunId: issues.executionRunId,
      runAgentId: heartbeatRuns.agentId, responsibleUserId: heartbeatRuns.responsibleUserId,
      status: heartbeatRuns.status }).from(issues).innerJoin(heartbeatRuns, and(
        eq(heartbeatRuns.companyId, issues.companyId), eq(heartbeatRuns.id, input.runId)))
      .where(and(eq(issues.companyId, input.companyId), eq(issues.id, input.issueId))).limit(1);
    return current?.projectId === input.projectId &&
      (current.projectWorkspaceId === null || current.projectWorkspaceId === input.selectedWorkspaceId) &&
      current.assigneeAgentId === input.agentId && current.executionRunId === input.runId &&
      current.runAgentId === input.agentId && current.responsibleUserId === input.responsibleUserId && current.status === "running";
  };
  if (!await assertTaskSelection()) return null;
  const actor = { type: "board" as const, source: "session" as const, userId: input.responsibleUserId };
  let candidate: NativeSelectedProjectSource;
  const existing = input.existingCandidate;
  if (existing) {
    const selectedRows = input.repositoryRows.filter(row => row.id === input.selectedWorkspaceId && row.companyId === input.companyId && row.projectId === input.projectId);
    if (selectedRows.length !== 1) return null;
    const parsed = nativePayloadSourceSnapshotSchema.safeParse(existing.payloadSourceSnapshot);
    if (existing.kind !== "project" || existing.id !== input.projectId || existing.input.kind !== "project" ||
      existing.input.projectId !== input.projectId || !parsed.success || parsed.data.owner.kind !== "project" ||
      parsed.data.owner.companyId !== input.companyId || parsed.data.owner.id !== input.projectId ||
      parsed.data.inputs.filter(source => source.kind === "project_workspace" && source.projectId === input.projectId &&
        source.workspaceId === input.selectedWorkspaceId).length !== 1) return null;

    candidate = { kind: "project", id: input.projectId, input: existing.input, payloadSourceSnapshot: parsed.data };
  } else {
    const capture = await captureNativeProjectSource(input.db, { companyId: input.companyId, projectId: input.projectId, actor });
    const parsed = nativePayloadSourceSnapshotSchema.safeParse(capture.payloadSourceSnapshot);
    const selectedRows = capture.workspaces.filter(row => row.id === input.selectedWorkspaceId &&
      row.companyId === input.companyId && row.projectId === input.projectId);
    const selectedPins = parsed.success ? parsed.data.inputs.filter(source => source.kind === "project_workspace" &&
      source.projectId === input.projectId && source.workspaceId === input.selectedWorkspaceId) : [];
    const rowProjection = (rows: Array<typeof projectWorkspaces.$inferSelect>) => rows.map(row => ({
      id: row.id, projectId: row.projectId, companyId: row.companyId, repoUrl: row.repoUrl, repoRef: row.repoRef,
      cwd: row.cwd, updatedAt: row.updatedAt.toISOString(),
    })).sort((a, b) => a.id.localeCompare(b.id));
    if (capture.input.kind !== "project" || capture.input.projectId !== input.projectId || selectedRows.length !== 1 ||
      !isDeepStrictEqual(rowProjection(input.repositoryRows), rowProjection(capture.workspaces)) || !parsed.success ||
      parsed.data.owner.kind !== "project" || parsed.data.owner.companyId !== input.companyId ||
      parsed.data.owner.id !== input.projectId || selectedPins.length !== 1) return null;
    candidate = { kind: "project", id: input.projectId, input: capture.input, payloadSourceSnapshot: parsed.data };
  }
  await assertNativeProjectSourceCurrent(input.db, { companyId: input.companyId, actor, source: candidate.input });
  if (!await assertTaskSelection()) return null;
  return candidate;
}

/** Capture the actual materialization and final redacted renderer output. This
 * does not grant a Run: current Project/workspace readers still validate the
 * resulting source set at every ordinary Native authority boundary. */
export async function prepareNativeProjectRepositoryPrompt(input: {
  db: Db; companyId: string; runId: string; agentId: string; responsibleUserId: string;
  issueId: string; projectId: string; selectedWorkspaceId: string; cwd: string;
  repositoryRows: Array<typeof projectWorkspaces.$inferSelect>;
  repositories: Repository[]; baseMarkdown: string; baseSourceMap: RendererMap | null;
}): Promise<{ taskPrompt: string; sourceMap: RendererMap | null; candidate: NativePreparedSourceCandidate | null }> {
  const paths = input.repositories.map(repo => path.relative(input.cwd, repo.cwd));
  const appendixMarkdown = formatNativeProjectRepositoryAppendix(paths);
  const redacted = await createRunSecretRedactionRegistry(input.db).redactForIssue(input.companyId, input.issueId, {
    baseMarkdown: input.baseMarkdown, appendixMarkdown,
  });
  const taskPrompt = [redacted.baseMarkdown, redacted.appendixMarkdown].filter(Boolean).join("\n\n");
  const unavailable = () => ({ taskPrompt, sourceMap: null, candidate: null });
  if (paths.length === 0 || !input.baseSourceMap || input.baseSourceMap.version !== 1 ||
    input.baseSourceMap.renderedMarkdownDigest !== digest(redacted.baseMarkdown) ||
    input.baseSourceMap.renderedMarkdownLength !== redacted.baseMarkdown.length ||
    !redacted.appendixMarkdown || redacted.appendixMarkdown !== appendixMarkdown ||
    new Set(paths).size !== paths.length || paths.some(value => !value || path.isAbsolute(value) || value === ".." || value.startsWith("../")))
    return unavailable();
  const candidate = await captureNativeSelectedProjectSource({ db: input.db, companyId: input.companyId,
    runId: input.runId, agentId: input.agentId, responsibleUserId: input.responsibleUserId, issueId: input.issueId,
    projectId: input.projectId, selectedWorkspaceId: input.selectedWorkspaceId, repositoryRows: input.repositoryRows });
  if (!candidate) return unavailable();
  const canonicalRoot = await realpath(input.cwd);
  if (new Set(input.repositories.map(repo => repo.workspaceId)).size !== input.repositories.length)
    return unavailable();
  for (const repo of input.repositories) {
    const row = input.repositoryRows.find(value => value.id === repo.workspaceId);
    const relative = path.relative(input.cwd, repo.cwd);
    if (!row || row.projectId !== input.projectId || row.companyId !== input.companyId ||
      row.repoUrl !== repo.repoUrl || row.repoRef !== repo.repoRef ||
      !relative.startsWith(".paperclip-repositories/") ||
      await realpath(repo.cwd) !== path.join(canonicalRoot, relative)) return unavailable();
  }
  const finalCandidate = await captureNativeSelectedProjectSource({ db: input.db, companyId: input.companyId,
    runId: input.runId, agentId: input.agentId, responsibleUserId: input.responsibleUserId, issueId: input.issueId,
    projectId: input.projectId, selectedWorkspaceId: input.selectedWorkspaceId, repositoryRows: input.repositoryRows,
    existingCandidate: candidate });
  if (!finalCandidate) return unavailable();
  return { taskPrompt,
    sourceMap: { version: 1, renderedMarkdownDigest: digest(taskPrompt), renderedMarkdownLength: taskPrompt.length,
      references: [...input.baseSourceMap.references, { kind: "project", id: input.projectId }] },
    candidate: finalCandidate };
}
