import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { and, eq } from "drizzle-orm";
import { heartbeatRuns, issues, type Db, type projectWorkspaces } from "@paperclipai/db";
import { captureNativeProjectSource, assertNativeProjectSourceCurrent } from "../native-direct-input.js";
import { createRunSecretRedactionRegistry } from "../run-secret-redaction.js";
import type { NativePreparedSourceCandidate, NativeRenderedSourceReference } from "./native-execution-input.js";

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
  if (!await assertTaskSelection()) return unavailable();
  const actor = { type: "board" as const, source: "session" as const, userId: input.responsibleUserId };
  const capture = await captureNativeProjectSource(input.db, { companyId: input.companyId, projectId: input.projectId, actor });
  const selected = capture.workspaces.find(row => row.id === input.selectedWorkspaceId);
  const canonicalRoot = await realpath(input.cwd);
  const rowProjection = (rows: Array<typeof projectWorkspaces.$inferSelect>) => rows.map(row => ({
    id: row.id, projectId: row.projectId, companyId: row.companyId, repoUrl: row.repoUrl, repoRef: row.repoRef,
    cwd: row.cwd, updatedAt: row.updatedAt.toISOString(),
  })).sort((a, b) => a.id.localeCompare(b.id));
  if (!selected || !isDeepStrictEqual(rowProjection(input.repositoryRows), rowProjection(capture.workspaces)) ||
    new Set(input.repositories.map(repo => repo.workspaceId)).size !== input.repositories.length)
    return unavailable();
  for (const repo of input.repositories) {
    const row = capture.workspaces.find(value => value.id === repo.workspaceId);
    const relative = path.relative(input.cwd, repo.cwd);
    if (!row || row.projectId !== input.projectId || row.companyId !== input.companyId ||
      row.repoUrl !== repo.repoUrl || row.repoRef !== repo.repoRef ||
      !relative.startsWith(".paperclip-repositories/") ||
      await realpath(repo.cwd) !== path.join(canonicalRoot, relative)) return unavailable();
  }
  await assertNativeProjectSourceCurrent(input.db, { companyId: input.companyId, actor, source: capture.input });
  if (!await assertTaskSelection()) return unavailable();
  return { taskPrompt,
    sourceMap: { version: 1, renderedMarkdownDigest: digest(taskPrompt), renderedMarkdownLength: taskPrompt.length,
      references: [...input.baseSourceMap.references, { kind: "project", id: input.projectId }] },
    candidate: { kind: "project", id: input.projectId, input: capture.input, payloadSourceSnapshot: capture.payloadSourceSnapshot } };
}
