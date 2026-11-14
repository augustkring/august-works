import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockRegistry = vi.hoisted(() => ({
  getById: vi.fn(),
  getByKey: vi.fn(),
  upsertConfig: vi.fn(),
  getCompanySettings: vi.fn(),
  upsertCompanySettings: vi.fn(),
}));

const mockLifecycle = vi.hoisted(() => ({
  load: vi.fn(),
  upgrade: vi.fn(),
  unload: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
}));

const mockSecretService = vi.hoisted(() => ({
  getById: vi.fn(),
  syncSecretRefsForTarget: vi.fn(),
}));

vi.mock("../services/plugin-registry.js", () => ({
  pluginRegistryService: () => mockRegistry,
}));

vi.mock("../services/plugin-lifecycle.js", () => ({
  pluginLifecycleManager: () => mockLifecycle,
}));

vi.mock("../services/activity-log.js", () => ({
  logActivity: vi.fn(),
}));

vi.mock("../services/secrets.js", () => ({
  secretService: () => mockSecretService,
}));

vi.mock("../services/live-events.js", () => ({
  publishGlobalLiveEvent: vi.fn(),
}));

// Load the mocked module graph during collection, outside the unchanged test
// behavior budget. Each test still receives a fresh app and cleared mocks.
const [{ pluginRoutes }, { errorHandler }] = await Promise.all([
  import("../routes/plugins.js"),
  import("../middleware/index.js"),
]);

async function createApp(
  actor: Record<string, unknown>,
  loaderOverrides: Record<string, unknown> = {},
  routeOverrides: {
    db?: unknown;
    jobDeps?: unknown;
    toolDeps?: unknown;
    bridgeDeps?: unknown;
    captureJsonContext?: (context: unknown, body: unknown) => void;
  } = {},
) {
  const loader = {
    installPlugin: vi.fn(),
    ...loaderOverrides,
  };

  const app = express();
  app.use(express.json());
  if (routeOverrides.captureJsonContext) {
    app.use((_req, res, next) => {
      const originalJson = res.json.bind(res);
      res.json = ((body: unknown) => {
        routeOverrides.captureJsonContext?.((res as any).__errorContext, body);
        return originalJson(body);
      }) as typeof res.json;
      next();
    });
  }
  app.use((req, _res, next) => {
    req.actor = actor as typeof req.actor;
    next();
  });
  app.use("/api", pluginRoutes(
    (routeOverrides.db ?? {}) as never,
    loader as never,
    routeOverrides.jobDeps as never,
    undefined,
    routeOverrides.toolDeps as never,
    routeOverrides.bridgeDeps as never,
  ));
  app.use(errorHandler);

  return { app, loader };
}

function createSelectQueueDb(rows: Array<Array<Record<string, unknown>>>) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(rows.shift() ?? [])),
        })),
      })),
    })),
  };
}

const companyA = "22222222-2222-4222-8222-222222222222";
const companyB = "33333333-3333-4333-8333-333333333333";
const agentA = "44444444-4444-4444-8444-444444444444";
const runA = "55555555-5555-4555-8555-555555555555";
const projectA = "66666666-6666-4666-8666-666666666666";
const pluginId = "11111111-1111-4111-8111-111111111111";
const secretId = "77777777-7777-4777-8777-777777777777";

function boardActor(overrides: Record<string, unknown> = {}) {
  return {
    type: "board",
    userId: "user-1",
    source: "session",
    isInstanceAdmin: false,
    companyIds: [companyA],
    ...overrides,
  };
}

function agentActor(overrides: Record<string, unknown> = {}) {
  return {
    type: "agent",
    agentId: agentA,
    companyId: companyA,
    runId: runA,
    source: "agent_jwt",
    ...overrides,
  };
}

function readyPlugin() {
  mockRegistry.getById.mockResolvedValue({
    id: pluginId,
    pluginKey: "paperclip.example",
    version: "1.0.0",
    status: "ready",
  });
}

describe("opaque plugin route paid admission",()=>{
 for(const actor of [agentActor(),boardActor()]) it(`denies ${actor.type} fallback before worker invocation`,async()=>{
  const executeTool=vi.fn();
  const {app}=await createApp(actor,{}, {db:createSelectQueueDb([[{companyId:companyA}],[{companyId:companyA,agentId:agentA}],[{companyId:companyA}]]),toolDeps:{toolDispatcher:{listToolsForAgent:vi.fn(),getTool:vi.fn(()=>({name:"fixture:read_status"})),executeTool}}});
  const response=await request(app).post("/api/plugins/tools/execute").send({tool:"fixture:read_status",parameters:{},runContext:{companyId:companyA,agentId:agentA,runId:runA,projectId:projectA}});
  expect(response.status).toBe(409);expect(response.body).toMatchObject({code:"configuration_incomplete",reasonCode:"tool_model_effect_unqualified",configurationIncomplete:{owner:"Managed model gateway owner",actionUrl:"/apps"}});expect(executeTool).not.toHaveBeenCalled();
 });
 for(const endpoint of ["bridge/action","actions/test","api/test","webhooks/test"]) it(`denies raw agent opaque ${endpoint} before worker`,async()=>{
  const call=vi.fn();const {app}=await createApp(agentActor(),{},{bridgeDeps:{workerManager:{call}},toolDeps:{toolDispatcher:{listToolsForAgent:vi.fn(),getTool:vi.fn(),executeTool:vi.fn()}}});
  const response=await request(app).post(`/api/plugins/${pluginId}/${endpoint}`).send({key:"test",companyId:companyA});
  expect(response.status).toBe(409);expect(response.body.code).toBe("configuration_incomplete");expect(call).not.toHaveBeenCalled();
 });
 it("retains nonpaid plugin tool discovery",async()=>{
  const listToolsForAgent=vi.fn(()=>[]);const executeTool=vi.fn();
  const {app}=await createApp(agentActor(),{},{toolDeps:{toolDispatcher:{listToolsForAgent,getTool:vi.fn(),executeTool}}});
  expect((await request(app).get("/api/plugins/tools")).status).toBe(200);expect(listToolsForAgent).toHaveBeenCalled();expect(executeTool).not.toHaveBeenCalled();
 });
});
