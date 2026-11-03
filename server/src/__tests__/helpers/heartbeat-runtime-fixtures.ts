import type { Db } from "@paperclipai/db";
import { seedCurrentHumanMembership } from "./current-human-membership-fixture.js";

/** Install a synthetic API origin for heartbeat fixtures that only build
 * managed runtime tool configuration. Real HTTP delivery is tested elsewhere. */
export function installHeartbeatApiUrlFixture() {
  const prior = process.env.PAPERCLIP_API_URL;
  if (!prior) process.env.PAPERCLIP_API_URL = "http://127.0.0.1:3100";
  return () => {
    if (prior === undefined) delete process.env.PAPERCLIP_API_URL;
    else process.env.PAPERCLIP_API_URL = prior;
  };
}

/** Bind a fixture's responsible Human to the actual company and role tables. */
export async function seedHeartbeatResponsibleHuman(
  db: Db,
  companyId: string,
  userId: string,
  role: "owner" | "admin" | "operator" | "viewer" = "owner",
) {
  await seedCurrentHumanMembership(db, companyId, userId, role);
}
