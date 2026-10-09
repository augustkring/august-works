import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { and, eq } from "drizzle-orm";
import * as authorization from "../services/authorization.js";
import {
  companies,
  companyMemberships,
  principalPermissionGrants,
  createDb,
  issues,
  approvals,
  issueApprovals,
  agents,
  projects,
  decisionQueues,
} from "@paperclipai/db";
import { experienceRoutes } from "../routes/experience.js";
import { errorHandler } from "../middleware/error-handler.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)(
  "V9 experience on migrated PostgreSQL",
  () => {
    let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
    let db: ReturnType<typeof createDb>;
    let companyId: string, foreignId: string;
    const userId = "experience-member";
    beforeAll(async () => {
      database = await startEmbeddedPostgresTestDatabase("aw-v9-experience-");
      db = createDb(database.connectionString);
    });
    afterAll(async () => {
      await database?.cleanup();
    });
    afterEach(() => vi.restoreAllMocks());
    beforeEach(async () => {
      companyId = randomUUID();
      foreignId = randomUUID();
      for (const id of [companyId, foreignId])
        await db.insert(companies).values({
          id,
          name: "Experience company",
          issuePrefix: `E${id.slice(0, 7)}`,
        });
      await db.insert(companyMemberships).values({
        companyId,
        principalType: "user",
        principalId: userId,
        membershipRole: "viewer",
        status: "active",
      });
      await instanceSettingsService(db).updateExperimental({
        experience_projection_v9: false,
        home_v9: false,
        progressive_shell_v9: false,
        ambient_commands_v9: false,
      });
    });
    function app(actor: Express.Request["actor"]) {
      const application = express();
      application.use(express.json());
      application.use((req, _res, next) => {
        req.actor = actor;
        next();
      });
      application.use("/api", experienceRoutes(db));
      application.use(errorHandler);
      return application;
    }
    const member = () => ({
      type: "board" as const,
      source: "session" as const,
      userId,
      companyIds: [companyId],
    });
    it("admits only deterministic current-scope commands and native-visible resource matches", async () => {
      const url = `/api/companies/${companyId}/experience/commands`;
      await request(app(member())).get(url).expect(404);
      await instanceSettingsService(db).updateExperimental({
        experience_projection_v9: true,
        ambient_commands_v9: true,
      });
      const task = randomUUID(),
        hidden = randomUUID(),
        foreign = randomUUID(),
        project = randomUUID(),
        agent = randomUUID();
      await db.insert(issues).values([
        { id: task, companyId, title: "Visible command match" },
        {
          id: hidden,
          companyId,
          title: "Hidden command match",
          hiddenAt: new Date(),
        },
        { id: foreign, companyId: foreignId, title: "Foreign command match" },
      ]);
      await db
        .insert(projects)
        .values({ id: project, companyId, name: "Command project" });
      await db.insert(agents).values({
        id: agent,
        companyId,
        name: "Command agent",
        role: "general",
        adapterType: "process",
      });
      const response = await request(app(member()))
        .get(`${url}?q=command`)
        .expect(200);
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.body.semanticDrafting).toBe("unqualified");
      expect(
        response.body.resources.map((resource: { id: string }) => resource.id),
      ).toContain(task);
      expect(JSON.stringify(response.body)).not.toContain(
        "Hidden command match",
      );
      expect(JSON.stringify(response.body)).not.toContain(
        "Foreign command match",
      );
      const ids = response.body.commands.map(
        (command: { id: string }) => command.id,
      );
      expect(ids).toContain("create_task");
      expect(ids).not.toContain("connect_app");
      expect(ids).not.toContain("run_workflow");
      expect(ids).not.toContain("ask_august");
      expect(ids).not.toContain("company");
      const scoped = await request(app(member()))
        .get(`${url}?q=${encodeURIComponent("open agent command")}`)
        .expect(200);
      expect(
        scoped.body.resources.every(
          (resource: { kind: string }) => resource.kind === "agent",
        ),
      ).toBe(true);
      const semantic = await request(app(member()))
        .get(`${url}?q=${encodeURIComponent("create workflow sales outreach")}`)
        .expect(200);
      expect(semantic.body.resources).toEqual([]);
      await request(app(member()))
        .get(`${url}?expectedUserId=previous-account`)
        .expect(409);
      await request(app(member()))
        .get(`${url}?q=${"x".repeat(181)}`)
        .expect(400);
      await db.insert(principalPermissionGrants).values({
        companyId,
        principalType: "user",
        principalId: userId,
        permissionKey: "tools:manage_connections",
      });
      const granted = await request(app(member())).get(url).expect(200);
      expect(
        granted.body.commands.map((command: { id: string }) => command.id),
      ).toContain("connect_app");
      await db
        .delete(companyMemberships)
        .where(eq(companyMemberships.companyId, companyId));
      await request(app(member())).get(url).expect(403);
    });
    it("keeps ten Company categories stable while filtering current native grants and account context", async () => {
      await instanceSettingsService(db).updateExperimental({
        experience_projection_v9: true,
        progressive_shell_v9: true,
      });
      const url = `/api/companies/${companyId}/experience/company`;
      await request(app(member())).get(url).expect(403);
      await db
        .update(companyMemberships)
        .set({ membershipRole: "owner" })
        .where(eq(companyMemberships.companyId, companyId));
      await db.insert(principalPermissionGrants).values({
        companyId,
        principalType: "user",
        principalId: userId,
        permissionKey: "users:invite",
      });
      const response = await request(app(member())).get(url).expect(200);
      expect(response.body.sections).toHaveLength(10);
      const entries = response.body.sections
        .flatMap(
          (section: { entries: Array<{ id: string }> }) => section.entries,
        )
        .map((entry: { id: string }) => entry.id);
      expect(entries).toContain("company_identity");
      expect(entries).toContain("members");
      expect(entries).not.toContain("roles");
      expect(entries).not.toContain("billing");
      await request(app(member()))
        .get(`${url}?expectedUserId=another-account`)
        .expect(409);
      await db
        .delete(principalPermissionGrants)
        .where(eq(principalPermissionGrants.companyId, companyId));
      await request(app(member())).get(url).expect(403);
      await db
        .update(companyMemberships)
        .set({ membershipRole: "viewer" })
        .where(eq(companyMemberships.companyId, companyId));
      await request(app(member())).get(url).expect(403);
    });
    it.each(["users:invite", "tools:manage_connections"] as const)(
      "rechecks %s revoked during the Company read before returning controls",
      async (permission) => {
        await instanceSettingsService(db).updateExperimental({
          experience_projection_v9: true,
          progressive_shell_v9: true,
        });
        await db.insert(principalPermissionGrants).values({
          companyId,
          principalType: "user",
          principalId: userId,
          permissionKey: "users:invite",
        });
        if (permission !== "users:invite")
          await db.insert(principalPermissionGrants).values({
            companyId,
            principalType: "user",
            principalId: userId,
            permissionKey: permission,
          });
        const real = authorization.authorizationService;
        let reads = 0,
          revoked = false;
        vi.spyOn(authorization, "authorizationService").mockImplementation(
          (connection) => {
            const native = real(connection);
            return {
              ...native,
              decide: async (input) => {
                const decision = await native.decide(input);
                if (
                  input.action === permission &&
                  ++reads === (permission === "users:invite" ? 2 : 1)
                ) {
                  expect(decision.allowed).toBe(true);
                  await db
                    .delete(principalPermissionGrants)
                    .where(
                      and(
                        eq(principalPermissionGrants.companyId, companyId),
                        eq(principalPermissionGrants.permissionKey, permission),
                      ),
                    );
                  revoked = true;
                }
                return decision;
              },
            };
          },
        );
        const response = await request(app(member()))
          .get(
            `/api/companies/${companyId}/experience/company?expectedUserId=${userId}`,
          )
          .expect(permission === "users:invite" ? 403 : 200);
        expect(revoked).toBe(true);
        if (permission === "tools:manage_connections") {
          const ids = response.body.sections.flatMap(
            (section: { entries: Array<{ id: string }> }) =>
              section.entries.map((entry) => entry.id),
          );
          expect(ids).toContain("members");
          expect(ids).not.toContain("connections");
        } else expect(response.body.sections).toBeUndefined();
      },
    );

    it("enforces disabled rollout, tenant scope and human-only access", async () => {
      await request(app(member()))
        .get(`/api/companies/${companyId}/experience`)
        .expect(404);
      await instanceSettingsService(db).updateExperimental({
        experience_projection_v9: true,
      });
      await request(app(member()))
        .get(`/api/companies/${foreignId}/experience`)
        .expect(403);
      await request(
        app({
          type: "agent",
          source: "agent_key",
          agentId: randomUUID(),
          companyId,
        }),
      )
        .get(`/api/companies/${companyId}/experience`)
        .expect(403);
    });
    it("returns native company tasks with current versions and cannot escalate a viewer profile", async () => {
      await instanceSettingsService(db).updateExperimental({
        experience_projection_v9: true,
      });
      const [own] = await db
        .insert(issues)
        .values({
          companyId,
          title: "Prepare sales brief",
          status: "in_progress",
          identifier: "EX-1",
          issueNumber: 1,
        })
        .returning();
      await db.insert(issues).values({
        companyId: foreignId,
        title: "Confidential foreign work",
        status: "in_progress",
        identifier: "FX-1",
        issueNumber: 1,
      });
      const response = await request(app(member()))
        .get(`/api/companies/${companyId}/experience?profile=security_admin`)
        .expect(200);
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.body.profile).toBe("member");
      expect(
        response.body.inProgress.find(
          (card: { id: string }) => card.id === own!.id,
        )?.source.version,
      ).toBe(String(own!.statusVersion));
      expect(JSON.stringify(response.body)).not.toContain(
        "Confidential foreign work",
      );
    });
    it("keeps a native attention page boundary visible without inventing a full-queue count", async () => {
      await instanceSettingsService(db).updateExperimental({
        experience_projection_v9: true,
      });
      await db.insert(approvals).values(
        Array.from({ length: 26 }, (_, index) => ({
          companyId,
          type: "request_board_approval",
          status: "pending" as const,
          payload: { title: `Bounded approval ${index}` },
        })),
      );
      const response = await request(app(member()))
        .get(`/api/companies/${companyId}/experience`)
        .expect(200);
      expect(
        response.body.dependencies.find(
          (dependency: { domain: string }) => dependency.domain === "attention",
        ),
      ).toMatchObject({ state: "partial", reason: "more_items_available" });
      expect(response.body.needsYou.length).toBeLessThanOrEqual(25);
      expect(response.body).not.toHaveProperty("totalCount");
      expect(
        response.body.needsYou.every(
          (card: {
            kind: string;
            consequence: string;
            actions: { operation: string }[];
          }) =>
            card.kind === "approval" &&
            card.consequence.includes("remains pending") &&
            card.actions.every((action) => action.operation === "open"),
        ),
      ).toBe(true);
    });
    it("filters attention linked to foreign work and leaves queue materialization to its native owner", async () => {
      await instanceSettingsService(db).updateExperimental({
        experience_projection_v9: true,
      });
      const [task] = await db
        .insert(issues)
        .values({ companyId: foreignId, title: "Foreign confidential task" })
        .returning();
      const [approval] = await db
        .insert(approvals)
        .values({
          companyId,
          type: "request_board_approval",
          status: "pending",
          payload: { title: "Confidential approval linked to foreign task" },
        })
        .returning();
      await db
        .insert(issueApprovals)
        .values({ companyId, issueId: task!.id, approvalId: approval!.id });
      const before = await db
        .select()
        .from(decisionQueues)
        .where(eq(decisionQueues.companyId, companyId));
      const response = await request(app(member()))
        .get(`/api/companies/${companyId}/experience`)
        .expect(200);
      expect(JSON.stringify(response.body)).not.toContain(
        "Confidential approval",
      );
      expect(
        await db
          .select()
          .from(decisionQueues)
          .where(eq(decisionQueues.companyId, companyId)),
      ).toEqual(before);
    });
    it("preserves authorized expert destinations and removes them when their native gate closes", async () => {
      const settings = instanceSettingsService(db);
      const original = await settings.getExperimental();
      const enabled = {
        experience_projection_v9: true,
        enableFoundationV1: true,
        enableContextEngineV1: true,
        agent_identities_v5: true,
        agent_provider_bindings_v5: true,
        agent_runtime_fabric_v5: true,
        role_packs_v5: true,
        playbooks_v5: true,
      };
      await settings.updateExperimental(enabled);
      await db.insert(principalPermissionGrants).values({
        companyId,
        principalType: "user",
        principalId: userId,
        permissionKey: "foundation:read",
      });
      try {
        const first = await request(app(member()))
          .get(`/api/companies/${companyId}/experience`)
          .expect(200);
        expect(first.body.advancedLinks).toEqual(
          expect.arrayContaining([
            { id: "role_packs", href: "/role-packs" },
            { id: "playbooks", href: "/playbooks" },
            { id: "skills", href: "/skills/studio" },
          ]),
        );
        expect(
          first.body.advancedLinks.some(
            (entry: { id: string }) => entry.id === "experimental",
          ),
        ).toBe(false);
        await settings.updateExperimental({
          role_packs_v5: false,
          playbooks_v5: false,
        });
        const second = await request(app(member()))
          .get(`/api/companies/${companyId}/experience`)
          .expect(200);
        expect(
          second.body.advancedLinks.some((entry: { id: string }) =>
            ["role_packs", "playbooks"].includes(entry.id),
          ),
        ).toBe(false);
        await db
          .update(companyMemberships)
          .set({ status: "inactive" })
          .where(eq(companyMemberships.companyId, companyId));
        await request(app(member()))
          .get(`/api/companies/${companyId}/experience`)
          .expect(403);
      } finally {
        await settings.updateExperimental(
          Object.fromEntries(
            Object.keys(enabled).map((key) => [
              key,
              original[key as keyof typeof original],
            ]),
          ),
        );
      }
    });
    it("checks current persisted membership even when middleware carries old company access", async () => {
      await instanceSettingsService(db).updateExperimental({
        experience_projection_v9: true,
      });
      await db
        .update(companyMemberships)
        .set({ status: "inactive" })
        .where(eq(companyMemberships.companyId, companyId));
      await request(app(member()))
        .get(`/api/companies/${companyId}/experience`)
        .expect(403);
      await request(app({ ...member(), isInstanceAdmin: true }))
        .get(`/api/companies/${companyId}/experience`)
        .expect(403);
    });
    it("lets an authorized owner choose depth without granting a viewer administrative authority", async () => {
      await instanceSettingsService(db).updateExperimental({
        experience_projection_v9: true,
      });
      await request(app(member()))
        .post(`/api/companies/${companyId}/experience/profile`)
        .send({ profile: "admin" })
        .expect(403);
      await db
        .update(companyMemberships)
        .set({ membershipRole: "owner" })
        .where(eq(companyMemberships.companyId, companyId));
      await db.insert(principalPermissionGrants).values(
        ["users:invite", "users:manage_permissions"].map((permissionKey) => ({
          companyId,
          principalType: "user",
          principalId: userId,
          permissionKey,
          grantedByUserId: userId,
        })),
      );
      const initial = await request(app(member()))
        .get(`/api/companies/${companyId}/experience`)
        .expect(200);
      expect(initial.body.profile).toBe("manager");
      expect(initial.body.availableProfiles).toContain("admin");
      await request(app(member()))
        .post(`/api/companies/${companyId}/experience/profile`)
        .send({ profile: "admin" })
        .expect(200);
      const chosen = await request(app(member()))
        .get(`/api/companies/${companyId}/experience`)
        .expect(200);
      expect(chosen.body.profile).toBe("admin");
      await db
        .update(companyMemberships)
        .set({ membershipRole: "viewer" })
        .where(eq(companyMemberships.companyId, companyId));
      await db
        .delete(principalPermissionGrants)
        .where(eq(principalPermissionGrants.companyId, companyId));
      const reduced = await request(app(member()))
        .get(`/api/companies/${companyId}/experience`)
        .expect(200);
      expect(reduced.body.profile).toBe("member");
      expect(reduced.body.availableProfiles).toEqual(["member"]);
    });
    it("fences a browser request issued for another account", async () => {
      await instanceSettingsService(db).updateExperimental({
        experience_projection_v9: true,
      });
      await request(app(member()))
        .get(
          `/api/companies/${companyId}/experience?expectedUserId=previous-account`,
        )
        .expect(409);
    });
    it("rejects broken graph updates atomically and preserves disabled defaults", async () => {
      const settings = instanceSettingsService(db);
      await expect(
        settings.updateExperimental({ home_v9: true }),
      ).rejects.toMatchObject({
        status: 400,
        details: { code: "V9_FEATURE_DEPENDENCY_INVALID" },
      });
      expect((await settings.getExperimental()).home_v9).toBe(false);
      await settings.updateExperimental({
        experience_projection_v9: true,
        home_v9: true,
      });
      await expect(
        settings.updateExperimental({ experience_projection_v9: false }),
      ).rejects.toMatchObject({ status: 400 });
      await settings.updateExperimental({
        experience_projection_v9: false,
        home_v9: false,
      });
    });
  },
);
