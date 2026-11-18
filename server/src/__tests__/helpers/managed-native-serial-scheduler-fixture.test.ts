import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRuntimeToolsToken } from "../../runtime-tools-token.js";
import { managedSerialSchedulerFixtureControls as controls } from "./managed-native-conversation-sandbox-host.js";

// These are fixture scheduling/authentication units. No DB Run, Plan, attempt,
// source receipt, Host qualification or gateway admission is created or mocked.
describe("managed serial scheduler fixture controls", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("registers A and B before A starts without a forward dependency or deadlock", async () => {
    type Host = { key: string };
    const entries = new Map<string, { leaseId: string; promise: Promise<Host>; closed: boolean; host?: Host }>();
    let release!: () => void;
    const deferred = new Promise<void>(resolve => { release = resolve; });
    const order: string[] = [];
    const first = controls.reserveSerialHostAdmission(entries, "A", "lease-A", Promise.resolve(), async prior => {
      order.push("A:start");
      expect(prior).toHaveLength(0);
      await deferred;
      for (const [, entry] of prior) await entry.promise;
      order.push("A:done");
      return { key: "A" };
    });
    const second = controls.reserveSerialHostAdmission(entries, "B", "lease-B",
      first.promise.then(() => undefined), async prior => {
        order.push("B:start");
        expect(prior.map(([key]) => key)).toEqual(["A"]);
        for (const [, entry] of prior) await entry.promise;
        order.push("B:done");
        return { key: "B" };
      });
    expect(entries.size).toBe(2);
    await Promise.resolve();
    expect(order).toEqual(["A:start"]);
    release();
    expect(await Promise.all([first.promise, second.promise])).toEqual([{ key: "A" }, { key: "B" }]);
    expect(order).toEqual(["A:start", "A:done", "B:start", "B:done"]);
  });

  it("cannot reserve the same key again or silently retry its rejected setup", async () => {
    const entries = new Map<string, { leaseId: string; promise: Promise<string>; closed: boolean; host?: string }>();
    const pending = controls.reserveSerialHostAdmission(entries, "A", "lease-A", Promise.resolve(), async () => {
      throw new Error("unfinished_previous_run");
    });
    await expect(pending.promise).rejects.toThrow("unfinished_previous_run");
    expect(() => controls.reserveSerialHostAdmission(entries, "A", "lease-A", Promise.resolve(), async () => "unexpected"))
      .toThrow("scheduler_software_host_duplicate_reservation");
  });

  it("rejects missing, placeholder, invalid, retired and wrong-Run HTTP credentials before provider effects", async () => {
    vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET", "serial-fixture-unit-secret");
    const companyId = randomUUID(), agentId = randomUUID(), runA = randomUUID(), runB = randomUUID();
    const mint = (runId: string) => {
      const minted = createRuntimeToolsToken({ companyId, agentId, runId, responsibleUserId: randomUUID(), scope: "worker_model",
        workerModelBinding: { planId: randomUUID(), workerId: agentId, workerAttemptId: randomUUID(),
          executionManifestId: randomUUID(), expectedPlanVersion: 1 } });
      if (!minted) throw new Error("unit_token_setup_failed");
      return minted.token;
    };
    const tokenA = mint(runA), tokenB = mint(runB);
    const admissions = new Map([
      [runA, { closed: true, host: { runId: runA, capabilityToken: tokenA } }],
      [runB, { closed: false, host: { runId: runB, capabilityToken: tokenB } }],
    ]);
    let providerEffects = 0;
    const app = express(); app.use(express.json());
    app.post("/runtime-tools/model/v1/messages", (req, res) => {
      try {
        const { host } = controls.serialModelAdmission(req.header("authorization"), { companyId, agentId }, admissions);
        controls.authenticateSerialModelRequest(req.header("authorization"), { companyId, agentId, ...host });
        providerEffects++;
        res.sendStatus(204);
      } catch { res.sendStatus(403); }
    });
    await request(app).post("/runtime-tools/model/v1/messages").send({ runId: runB }).expect(403);
    await request(app).post("/runtime-tools/model/v1/messages").set("x-api-key", "paperclip-managed-model-broker")
      .send({ runId: runB }).expect(403);
    await request(app).post("/runtime-tools/model/v1/messages").set("authorization", "Bearer invalid")
      .send({ runId: runB }).expect(403);
    await request(app).post("/runtime-tools/model/v1/messages").set("authorization", `Bearer ${tokenA}`)
      .send({ runId: runB }).expect(403);
    // Wrong-Run attachment: a valid B JWT cannot pass the final exact A
    // attachment check. No server-held B credential replaces the caller.
    admissions.set(runB, { closed: false, host: { runId: runA, capabilityToken: tokenA } });
    await request(app).post("/runtime-tools/model/v1/messages").set("authorization", `Bearer ${tokenB}`)
      .send({ runId: runA }).expect(403);
    expect(providerEffects).toBe(0);
  });

  it("admits a completion Reviewer's review_model credential like a worker credential, and no other family (MS1h8)", async () => {
    vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET", "serial-fixture-unit-secret");
    const companyId = randomUUID(), agentId = randomUUID(), runA = randomUUID(), runB = randomUUID();
    const user = randomUUID(), manifest = randomUUID();
    const token = (minted: { token: string } | null) => { if (!minted) throw new Error("unit_token_setup_failed"); return minted.token; };
    const review = (runId: string, reviewer = agentId) => token(createRuntimeToolsToken({ companyId, agentId: reviewer, runId,
      responsibleUserId: user, scope: "review_model", reviewModelBinding: { planId: randomUUID(), issueId: randomUUID(),
        interactionId: randomUUID(), decisionId: randomUUID(), sourceRunId: randomUUID(), sourceWorkerId: randomUUID(),
        sourceAgentId: randomUUID(), sourceAttemptId: randomUUID(), sourceResultId: randomUUID(), sourceReceiptDigest: "a".repeat(64),
        sourceResultCanonicalSha256: "b".repeat(64), reviewerAgentId: reviewer, reviewerRunId: runId, executionManifestId: manifest,
        expectedPlanVersion: 2 } }));
    const worker = (runId: string) => token(createRuntimeToolsToken({ companyId, agentId, runId, responsibleUserId: user,
      scope: "worker_model", workerModelBinding: { planId: randomUUID(), workerId: randomUUID(), workerAttemptId: randomUUID(),
        executionManifestId: manifest, expectedPlanVersion: 1 } }));
    const conversation = (runId: string) => token(createRuntimeToolsToken({ companyId, agentId, runId, responsibleUserId: user,
      scope: "conversation_model", conversationModelBinding: { issueId: randomUUID(), conversationSessionGeneration: 0,
        executionManifestId: manifest, executionManifestHash: "c".repeat(64) } }));
    const call = (credential: string, runId: string, capabilityToken: string, closed = false) => {
      const admissions = new Map([[runId, { closed, host: { runId, capabilityToken } }]]);
      try {
        const { host } = controls.serialModelAdmission(`Bearer ${credential}`, { companyId, agentId }, admissions);
        return controls.authenticateSerialModelRequest(`Bearer ${credential}`, { companyId, agentId, ...host }).claims.scope;
      } catch { return "refused"; }
    };
    const reviewB = review(runB), workerB = worker(runB), conversationB = conversation(runB);
    expect(call(reviewB, runB, reviewB)).toBe("review_model");
    expect(call(workerB, runB, workerB)).toBe("worker_model");
    expect(call(conversationB, runB, conversationB)).toBe("refused");
    const otherReviewer = review(runB, randomUUID());
    expect(call(otherReviewer, runB, otherReviewer)).toBe("refused");
    const reviewA = review(runA);
    expect(call(reviewA, runA, reviewA, true)).toBe("refused");
    // The attached provider credential must be the presented one.
    expect(call(reviewB, runB, review(runB))).toBe("refused");
  });
});
