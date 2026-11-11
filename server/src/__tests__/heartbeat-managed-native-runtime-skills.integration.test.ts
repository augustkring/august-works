import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  agents,
  companySkills,
  createDb,
  heartbeatRuns,
  heartbeatRunEvents,
  toolApplications,
  toolConnectionInstalls,
  toolConnections,
  toolMcpGatewayTokens,
  toolProfileBindings,
  toolProfileEntries,
  toolProfiles,
} from "@paperclipai/db";
import { companySkillService } from "../services/company-skills.ts";
import { heartbeatService } from "../services/heartbeat.ts";
import { instanceSettingsService } from "../services/instance-settings.ts";
import { resolveNativeRuntimeMcpSnapshot } from "../services/native-runtime/runtime-context.js";
import { boundedRunnerFailureDiagnostic, runManagedNativeConversationFrame } from "./helpers/managed-native-conversation-frame.js";
import { qualifiedOpenCodeBinary, makeFixtureTreeWritable } from "./helpers/managed-native-opencode-e2e-fixture.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof createDb>;
let home = "";
const cleanupDirs = new Set<string>();
beforeAll(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "heartbeat-managed-native-runtime-skills-"));
  vi.stubEnv("PAPERCLIP_HOME", home);
  database = await startEmbeddedPostgresTestDatabase("heartbeat-managed-native-runtime-skills-");
  db = createDb(database.connectionString, { maxConnections: 3 });
}, 60_000);
afterEach(async () => {
  await Promise.all(Array.from(cleanupDirs, dir => fs.rm(dir, { recursive: true, force: true })));
  cleanupDirs.clear();
});
afterAll(async () => {
  await database?.cleanup();
  vi.unstubAllEnvs();
  if (home) await makeFixtureTreeWritable(home).then(() => fs.rm(home, { recursive: true, force: true }));
}, 30_000);

it("materializes agent-pinned Skill versions and installed MCP assignments in real signed Native chat runs", async () => {
    const binary = qualifiedOpenCodeBinary();
    if (!binary) throw new Error("qualified_opencode_binary_unavailable");
    await instanceSettingsService(db).updateExperimental({ enableBetaSkills: true });

    const skillId = randomUUID();
    let skillKey = "";
    const skillDir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-native-versioned-skill-"));
    cleanupDirs.add(skillDir);
    const v1Body = "# Native Runtime Coach\n\nNative version one marker: native-skill-v1-5a1.\n";
    const v2Body = "# Native Runtime Coach\n\nNative version two marker: native-skill-v2-8b2.\n";
    let versionOneId = "";
    let versionTwoId = "";
    let sharedCompanyId = "";
    let installedConnectionId = "";
    let uninstalledConnectionId = "";
    let connectionSetReady = false;
    const selectedByAgent = new Map<string, string>();
    const actualRuns = new Map<string, { runId: string; selectedVersionId: string; digest: string; file: string; request: string }>();
    let secondaryIssueId = "";
    let secondaryWakeId = "";
    let primaryIssueId = "";
    let primaryWakeId = "";

    const frame = await runManagedNativeConversationFrame({
      db,
      root: home,
      opencodeBinary: binary,
      timeoutSec: 180,
      managedPrimaryAgentName: "Pinned Native Skill v1",
      managedAgentNames: ["Pinned Native Skill v2"],
      prepareNativeRuntimeContext: async ({ db: fixtureDb, companyId, agentId }) => {
        sharedCompanyId = companyId;
        if (!versionOneId) {
          skillKey = `company/${companyId}/native-runtime-coach-${skillId.slice(0, 8)}`;
          await fs.writeFile(path.join(skillDir, "SKILL.md"), v1Body, "utf8");
          await fixtureDb.insert(companySkills).values({
            id: skillId,
            companyId,
            key: skillKey,
            slug: `native-runtime-coach-${skillId.slice(0, 8)}`,
            name: "Native Runtime Coach",
            description: null,
            markdown: v1Body,
            sourceType: "local_path",
            sourceLocator: skillDir,
            trustLevel: "markdown_only",
            compatibility: "compatible",
            fileInventory: [{ path: "SKILL.md", kind: "skill" }],
            metadata: { sourceKind: "local_path" },
          });
          const service = companySkillService(fixtureDb);
          const first = await service.createVersion(companyId, skillId, { label: "v1" },
            { type: "user", userId: "native-runtime-skills-test" });
          versionOneId = first.id;
          await fs.writeFile(path.join(skillDir, "SKILL.md"), v2Body, "utf8");
          await fixtureDb.update(companySkills).set({ markdown: v2Body, updatedAt: new Date() })
            .where(eq(companySkills.id, skillId));
          const second = await service.createVersion(companyId, skillId, { label: "v2" },
            { type: "user", userId: "native-runtime-skills-test" });
          versionTwoId = second.id;
        }
        const selectedVersionId = selectedByAgent.size === 0 ? versionOneId : versionTwoId;
        selectedByAgent.set(agentId, selectedVersionId);
        const [agent] = await fixtureDb.select({ adapterConfig: agents.adapterConfig }).from(agents)
          .where(eq(agents.id, agentId)).limit(1);
        const adapterConfig = agent?.adapterConfig && typeof agent.adapterConfig === "object" && !Array.isArray(agent.adapterConfig)
          ? agent.adapterConfig as Record<string, unknown> : {};
        await fixtureDb.update(agents).set({ adapterConfig: { ...adapterConfig,
          paperclipSkillSync: { desiredSkills: [{ key: skillKey, versionId: selectedVersionId }] } } })
          .where(eq(agents.id, agentId));

        if (!connectionSetReady) {
          const [application] = await fixtureDb.insert(toolApplications).values({
            companyId,
            applicationKey: `native-runtime-${skillId.slice(0, 8)}`,
            name: "Native Runtime MCP",
            type: "mcp_http",
            status: "active",
          }).returning();
          const [installed, uninstalled] = await fixtureDb.insert(toolConnections).values([
            { companyId, applicationId: application!.id, name: "Installed Native MCP", uid: `native/${skillId}/installed`,
              transport: "mcp_remote", status: "active", enabled: true,
              config: { url: "https://installed.native.example.test/mcp" } },
            { companyId, applicationId: application!.id, name: "Uninstalled Native MCP", uid: `native/${skillId}/uninstalled`,
              transport: "mcp_remote", status: "active", enabled: true,
              config: { url: "https://uninstalled.native.example.test/mcp" } },
          ]).returning();
          installedConnectionId = installed!.id;
          uninstalledConnectionId = uninstalled!.id;
          const [profile] = await fixtureDb.insert(toolProfiles).values({ companyId,
            profileKey: `native-runtime:${skillId}`, name: "Native Runtime Assigned MCP", defaultAction: "deny" }).returning();
          await fixtureDb.insert(toolProfileEntries).values({ companyId, profileId: profile!.id,
            selectorType: "connection", effect: "include", applicationId: application!.id, connectionId: installedConnectionId });
          connectionSetReady = true;
        }
        const [profile] = await fixtureDb.select({ id: toolProfiles.id }).from(toolProfiles)
          .where(eq(toolProfiles.profileKey, `native-runtime:${skillId}`)).limit(1);
        await fixtureDb.insert(toolProfileBindings).values({ companyId, profileId: profile!.id,
          targetType: "agent", targetId: agentId });
        await fixtureDb.insert(toolConnectionInstalls).values({ companyId, connectionId: installedConnectionId,
          targetType: "agent", targetId: agentId });
      },
      providerReply: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "I received the real Native chat message." }] }),
      driveConversation: async ({ app, heartbeat, humanCookie, companyId, managedAgents, chatPath, onConversationOpened }) => {
        const request = await import("supertest").then(({ default: request }) => request);
        const origin = { Origin: "http://localhost" };
        const primaryChat = await request(app).post(chatPath).set("cookie", humanCookie).set(origin);
        if (primaryChat.status !== 200 || typeof primaryChat.body?.id !== "string")
          throw new Error(`native_runtime_skill_primary_chat_failed_${primaryChat.status}`);
        primaryIssueId = primaryChat.body.id;
        onConversationOpened(primaryIssueId);
        const primaryComment = await request(app).post(`/api/issues/${primaryIssueId}/comments`).set("cookie", humanCookie).set(origin)
          .send({ body: "Please answer using the assigned Native skill.", clientRequestId: randomUUID() });
        if (primaryComment.status !== 201 || typeof primaryComment.body?.id !== "string")
          throw new Error(`native_runtime_skill_primary_comment_failed_${primaryComment.status}`);
        primaryWakeId = primaryComment.body.id;
        const secondAgent = managedAgents?.[1];
        if (!secondAgent) throw new Error("native_runtime_skill_second_agent_missing");
        const secondChat = await request(app).post(`/api/companies/${companyId}/chats/${secondAgent.id}`)
          .set("cookie", humanCookie).set(origin);
        if (secondChat.status !== 200 || typeof secondChat.body?.id !== "string")
          throw new Error(`native_runtime_skill_second_chat_failed_${secondChat.status}`);
        secondaryIssueId = secondChat.body.id;
        const secondComment = await request(app).post(`/api/issues/${secondaryIssueId}/comments`).set("cookie", humanCookie).set(origin)
          .send({ body: "Please use the second agent's assigned Native skill.", clientRequestId: randomUUID() });
        if (secondComment.status !== 201 || typeof secondComment.body?.id !== "string")
          throw new Error(`native_runtime_skill_second_comment_failed_${secondComment.status}`);
        secondaryWakeId = secondComment.body.id;
        const primaryAgentId = [...selectedByAgent.keys()][0]!;
        const secondaryAgentId = [...selectedByAgent.keys()][1]!;
        const settleDeadline = Date.now() + 90_000;
        let primaryRun: typeof heartbeatRuns.$inferSelect | undefined;
        let secondaryRun: typeof heartbeatRuns.$inferSelect | undefined;
        while (Date.now() < settleDeadline) {
          await heartbeat.resumeQueuedRuns();
          await heartbeat.drainActiveRunExecutions();
          [primaryRun] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId),
            eq(heartbeatRuns.agentId, primaryAgentId), eq(heartbeatRuns.nativeIssueId, primaryIssueId)))
            .orderBy(desc(heartbeatRuns.createdAt)).limit(1);
          [secondaryRun] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId),
            eq(heartbeatRuns.agentId, secondaryAgentId), eq(heartbeatRuns.nativeIssueId, secondaryIssueId)))
            .orderBy(desc(heartbeatRuns.createdAt)).limit(1);
          if (primaryRun?.status === "succeeded" && secondaryRun?.status === "succeeded" && actualRuns.size === 2) break;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (primaryRun?.status !== "succeeded" || secondaryRun?.status !== "succeeded" || actualRuns.size !== 2) {
          const projectFailure = async (label: "primary" | "secondary", run: typeof primaryRun) => {
            if (!run) return { label, found: false };
            const events = await db.select({ seq: heartbeatRunEvents.seq, eventType: heartbeatRunEvents.eventType,
              payload: heartbeatRunEvents.payload })
              .from(heartbeatRunEvents).where(and(eq(heartbeatRunEvents.companyId, companyId),
                eq(heartbeatRunEvents.runId, run.id), inArray(heartbeatRunEvents.eventType, ["error", "turn.failed"])))
              .orderBy(asc(heartbeatRunEvents.seq)).limit(4);
            const stage = ["preparing", "dispatching", "running", "settling", "completed", "failed"]
              .find(value => value === run.executionStage) ?? "other";
            const phase = ["provider_running", "observed", "committed", "terminal_failure"]
              .find(value => value === run.nativePhase) ?? "other";
            return { label, found: true, status: ["queued", "running", "succeeded", "failed", "timed_out", "cancelled", "interrupted", "superseded"]
              .find(value => value === run.status) ?? "other",
              error: boundedRunnerFailureDiagnostic(0, { error: { code: run.errorCode, message: run.error } }).error,
              stage, phase, providerHookObserved: actualRuns.has(run.agentId),
              runnerFailures: events.map(event => ({ eventType: event.eventType === "error" ? "error" : "turn.failed",
                ...boundedRunnerFailureDiagnostic(event.seq, event.payload) })) };
          };
          try {
            console.info("native_runtime_skill_settlement_failure", JSON.stringify({
              providerHookObservedCount: actualRuns.size,
              runs: await Promise.all([projectFailure("primary", primaryRun), projectFailure("secondary", secondaryRun)]),
            }));
          } catch { console.info("native_runtime_skill_settlement_failure", JSON.stringify({ diagnosticRead: "unavailable" })); }
          throw new Error("native_runtime_skill_agent_runs_not_settled_inside_signed_fixture");
        }
        return { issueId: primaryIssueId, wakeCommentId: primaryWakeId };
      },
      beforeProviderResponse: async ({ db: fixtureDb, agentId, run, request, readStagedSkillFile }) => {
        if (run.status !== "running" || run.runtimeMode !== "native" || !selectedByAgent.has(agentId))
          throw new Error("native_runtime_skill_live_run_binding_missing");
        const profileJson = run.runnerProfileJson && typeof run.runnerProfileJson === "object"
          ? run.runnerProfileJson as Record<string, unknown> : {};
        const execution = profileJson.nativeExecutionInput && typeof profileJson.nativeExecutionInput === "object"
          ? profileJson.nativeExecutionInput as Record<string, any> : {};
        const runtimeContext = execution.runtimeContext && typeof execution.runtimeContext === "object"
          ? execution.runtimeContext as Record<string, any> : {};
        const skills = Array.isArray(runtimeContext.skills) ? runtimeContext.skills as Array<Record<string, any>> : [];
        const selected = skills.find(skill => skill.key === skillKey);
        const expectedVersionId = selectedByAgent.get(agentId)!;
        const expectedBody = expectedVersionId === versionOneId ? v1Body : v2Body;
        expect(selected).toMatchObject({ key: skillKey, versionId: expectedVersionId });
        if (!readStagedSkillFile) throw new Error("native_runtime_skill_signed_host_reader_missing");
        const physicalFile = await readStagedSkillFile(skillKey, "SKILL.md");
        expect(physicalFile).toBe(expectedBody);
        const mcp = runtimeContext.mcp && typeof runtimeContext.mcp === "object" ? runtimeContext.mcp as Record<string, unknown> : {};
        const expectedMcp = await resolveNativeRuntimeMcpSnapshot({ db: fixtureDb,
          agent: { id: agentId, companyId: sharedCompanyId }, runId: run.id });
        expect(mcp).toMatchObject({ bindingId: expectedMcp.bindingId, digest: expectedMcp.digest });
        expect(expectedMcp.bindingId).toBe(`native-mcp:${run.id}`);
        const installs = await fixtureDb.select({ connectionId: toolConnectionInstalls.connectionId })
          .from(toolConnectionInstalls).where(and(eq(toolConnectionInstalls.companyId, sharedCompanyId),
            eq(toolConnectionInstalls.targetType, "agent"), eq(toolConnectionInstalls.targetId, agentId)));
        expect(installs.map(row => row.connectionId)).toEqual([installedConnectionId]);
        expect(installs.map(row => row.connectionId)).not.toContain(uninstalledConnectionId);
        const bearerRows = await fixtureDb.select({ id: toolMcpGatewayTokens.id, tokenPrefix: toolMcpGatewayTokens.tokenPrefix,
          subjectId: toolMcpGatewayTokens.subjectId, revokedAt: toolMcpGatewayTokens.revokedAt })
          .from(toolMcpGatewayTokens).where(and(eq(toolMcpGatewayTokens.companyId, sharedCompanyId),
            eq(toolMcpGatewayTokens.subjectType, "heartbeat_run"), eq(toolMcpGatewayTokens.subjectId, run.id)));
        expect(bearerRows).toHaveLength(1);
        expect(bearerRows[0]).toMatchObject({ subjectId: run.id, revokedAt: null });
        expect(bearerRows[0]!.tokenPrefix.startsWith("pcgw_")).toBe(true);
        const [currentAgent] = await fixtureDb.select({ adapterConfig: agents.adapterConfig }).from(agents)
          .where(eq(agents.id, agentId)).limit(1);
        const serializedInput = JSON.stringify(profileJson);
        expect(JSON.stringify(currentAgent?.adapterConfig)).not.toContain("PAPERCLIP_NATIVE_MCP_TOKEN");
        expect(JSON.stringify(currentAgent?.adapterConfig)).not.toContain("paperclipRuntimeMcpServers");
        expect(JSON.stringify(currentAgent?.adapterConfig)).not.toContain("pcgw_");
        expect(serializedInput).not.toContain("PAPERCLIP_NATIVE_MCP_TOKEN");
        expect(serializedInput).not.toContain("paperclipRuntimeMcpServers");
        expect(serializedInput).not.toContain("pcgw_");
        expect(JSON.stringify(request.body)).not.toContain("pcgw_");
        const log = await heartbeatService(fixtureDb).readLog(run.id);
        expect(log.content).not.toContain("pcgw_");
        actualRuns.set(agentId, { runId: run.id, selectedVersionId: expectedVersionId,
          digest: String(selected.bundle.digest), file: physicalFile, request: JSON.stringify(request.body) });
      },
    });
    expect(frame.success).toBe(true);
    expect(primaryWakeId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(secondaryWakeId).toMatch(/^[0-9a-f-]{36}$/i);
    const primaryAgentId = [...selectedByAgent.keys()][0]!;
    const secondaryAgentId = [...selectedByAgent.keys()][1]!;
    const [primaryRun] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, sharedCompanyId),
      eq(heartbeatRuns.agentId, primaryAgentId), eq(heartbeatRuns.nativeIssueId, primaryIssueId)))
      .orderBy(desc(heartbeatRuns.createdAt)).limit(1);
    const [secondaryRun] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, sharedCompanyId),
      eq(heartbeatRuns.agentId, secondaryAgentId), eq(heartbeatRuns.nativeIssueId, secondaryIssueId)))
      .orderBy(desc(heartbeatRuns.createdAt)).limit(1);
    expect(primaryRun).toMatchObject({ runtimeMode: "native", status: "succeeded" });
    expect(secondaryRun).toMatchObject({ runtimeMode: "native", status: "succeeded" });
    expect(actualRuns.get(primaryRun!.agentId)).toMatchObject({ runId: primaryRun!.id, selectedVersionId: versionOneId, file: v1Body });
    expect(actualRuns.get(secondaryRun!.agentId)).toMatchObject({ runId: secondaryRun!.id, selectedVersionId: versionTwoId, file: v2Body });
    expect(actualRuns.get(primaryRun!.agentId)?.digest).not.toBe(actualRuns.get(secondaryRun!.agentId)?.digest);
  }, 300_000);
