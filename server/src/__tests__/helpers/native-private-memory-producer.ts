import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { companyMemberships, memoryRecords, toolPolicies, type Db } from "@paperclipai/db";
import { heartbeatService } from "../../services/heartbeat.js";
import { createLocalAgentJwt, verifyLocalAgentJwt } from "../../agent-auth-jwt.js";
import { createToolGatewayService } from "../../services/tool-gateway.js";
import { instanceSettingsService } from "../../services/instance-settings.js";
import { memoryService } from "../../services/memory/memory-service.js";
import { seedCurrentHumanSourceActor } from "./current-human-source-fixture.js";
import type { NativeSessionBackend } from "../../vendor/paperclip-runner/index.js";
import { CONTROL_PLANE_CONFORMANCE_RESULT, CONTROL_PLANE_CONFORMANCE_TERMINAL } from "../../vendor/paperclip-runner/testing.js";

/** Create a private Memory through an actual Native heartbeat and the real
 * Tool Gateway. The returned Memory is sourced from the heartbeat Task; no
 * Context manifest or payload snapshot is manufactured by the fixture. */
export async function createNativePrivateMemoryThroughHeartbeat(input: {
  db: Db;
  companyId: string;
  agentId: string;
  userId: string;
  issueId: string;
  content: string;
  bindingKey: string;
}) {
  const previousSecret = process.env.PAPERCLIP_AGENT_JWT_SECRET;
  process.env.PAPERCLIP_AGENT_JWT_SECRET = randomUUID();
  const settings = instanceSettingsService(input.db);
  const previousSettings = await settings.getExperimental();
  await settings.updateExperimental({ enableNativeRunner: true, enablePrivateAgentMemoryV1: true });
  let releaseTurn = () => {};
  let signalStarted = () => {};
  const turnGate = new Promise<void>(resolve => { releaseTurn = resolve; });
  const turnStarted = new Promise<void>(resolve => { signalStarted = resolve; });
  const backend: NativeSessionBackend = {
    async descriptor() {
      return { kind: "mock", name: "native-private-memory-producer", version: "1",
        capabilities: { resume: false, typedEvents: true, steering: false, interruption: true, structuredResult: true },
        runtimeContextCapabilities: { instructions: "native", skills: "native", mcp: "native" } };
    },
    async openSession(openInput) {
      const turnId = `native-private-memory-${openInput.identity.runId}`;
      return {
        identity: () => openInput.identity,
        async capabilities() { return { resume: false, typedEvents: true, steering: false, interruption: true, structuredResult: true }; },
        async *events() {
          await turnStarted;
          await turnGate;
          yield { schema: "paperclip.prp.event.v1" as const, sourceEventId: `${turnId}:terminal`, sourceSeq: 1,
            sourceInstanceId: turnId, sourceKind: "runner" as const, runId: openInput.identity.runId,
            normalizedSessionId: openInput.identity.sessionId, turnId, eventType: "turn.completed" as const,
            schemaVersion: 1 as const, priority: 0 as const, emittedAt: new Date().toISOString(), payload: {} };
        },
        async startTurn() { signalStarted(); return { turnId }; },
        async result() {
          const result = structuredClone(CONTROL_PLANE_CONFORMANCE_RESULT);
          return { result, terminal: { ...CONTROL_PLANE_CONFORMANCE_TERMINAL,
            reportedWorkDisposition: result.reportedWorkDisposition }, turnId };
        },
        async snapshot() { return { backendKind: "mock", sessionId: openInput.identity.sessionId,
          identity: openInput.identity, providerSessionId: "native-private-memory" } as never; },
        async close() { signalStarted(); releaseTurn(); },
      };
    },
  };
  const heartbeat = heartbeatService(input.db, { nativeSessionBackendFactory: () => backend });
  try {
    const human = await seedCurrentHumanSourceActor(input.db, [input.companyId], input.userId);
    const memoryActor = { principal: { type: "user" as const, userId: input.userId }, authorizationActor: human };
    const binding = await memoryService(input.db).createCompanyBinding(input.companyId,
      { key: input.bindingKey, name: "Native private Memory fixture", providerKey: "local" }, memoryActor);
    await memoryService(input.db).addBindingTarget(input.companyId, binding.id,
      { targetType: "agent", targetId: input.agentId }, memoryActor);
    const run = await heartbeat.invoke(input.agentId, "on_demand", { issueId: input.issueId }, "manual",
      { actorType: "user", actorId: input.userId });
    if (!run) throw new Error("Heartbeat did not create the actual private Memory producer run");
    let startupTimer: ReturnType<typeof setTimeout> | undefined;
    const started = await Promise.race([turnStarted.then(() => true), new Promise<false>(resolve => {
      startupTimer = setTimeout(() => resolve(false), 15_000);
      startupTimer.unref();
    })]);
    if (startupTimer) clearTimeout(startupTimer);
    if (!started) throw new Error("Actual private Memory producer did not reach the Native backend");
    const token = createLocalAgentJwt(input.agentId, input.companyId, "paperclip_runner", run.id, input.userId);
    const claims = token ? verifyLocalAgentJwt(token) : null;
    if (!token || !claims) throw new Error("Could not verify the actual Memory producer AgentJWT");
    const memberships = await input.db.select({ companyId: companyMemberships.companyId,
      membershipRole: companyMemberships.membershipRole, status: companyMemberships.status })
      .from(companyMemberships).where(and(eq(companyMemberships.companyId, input.companyId),
        eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, input.userId)));
    const actor = { type: "agent" as const, source: "agent_jwt" as const, companyId: claims.company_id,
      agentId: claims.sub, runId: claims.run_id, onBehalfOfUserId: claims.responsible_user_id,
      authenticatedCredentialExpiresAt: claims.exp * 1000, keyScope: claims.key_scope ?? { kind: "standard" as const },
      onBehalfOfMemberships: memberships };
    await input.db.insert(toolPolicies).values({ companyId: input.companyId,
      name: `Native private Memory remember ${randomUUID()}`, policyType: "allow",
      selectors: { toolName: "paperclip-self:remember" } });
    const gateway = createToolGatewayService(input.db);
    const session = await gateway.createSession({ companyId: input.companyId, agentId: input.agentId,
      runId: run.id, issueId: input.issueId, authorizationActor: actor });
    const result = await gateway.executeTool({ sessionToken: session.token, tool: "paperclip-self:remember",
      parameters: { scope: "private", memoryType: "lesson", content: input.content,
        bindingKey: input.bindingKey, idempotencyKey: randomUUID() } });
    const resultObject = result.result && typeof result.result === "object" ? result.result as Record<string, unknown> : null;
    const resultData = resultObject?.data && typeof resultObject.data === "object" ? resultObject.data as Record<string, unknown> : null;
    const resultRecord = resultData?.record && typeof resultData.record === "object" ? resultData.record as Record<string, unknown> : null;
    if (result.status !== "completed" || typeof resultRecord?.id !== "string")
      throw new Error(`Actual Native Tool Gateway Memory producer failed: ${JSON.stringify({ status: result.status,
        reasonCode: "reasonCode" in result ? result.reasonCode : null })}`);
    const [record] = await input.db.select().from(memoryRecords).where(and(eq(memoryRecords.companyId, input.companyId),
      eq(memoryRecords.id, resultRecord.id)));
    if (!record) throw new Error("The actual Tool Gateway private Memory record was not persisted");
    return { runId: run.id, actor, record };
  } finally {
    releaseTurn();
    await heartbeat.drainActiveRunExecutions();
    await settings.updateExperimental({ enableNativeRunner: previousSettings.enableNativeRunner,
      enablePrivateAgentMemoryV1: previousSettings.enablePrivateAgentMemoryV1 });
    if (previousSecret === undefined) delete process.env.PAPERCLIP_AGENT_JWT_SECRET;
    else process.env.PAPERCLIP_AGENT_JWT_SECRET = previousSecret;
  }
}
