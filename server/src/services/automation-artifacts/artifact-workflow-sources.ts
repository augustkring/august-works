import { and, eq } from "drizzle-orm";
import { automationArtifacts, type Db } from "@paperclipai/db";
import { z } from "zod";
import { forbidden } from "../../errors.js";
import type { AuthorizationActor } from "../authorization.js";
import type { NativeReadScope } from "../analytical-reader.js";
import { assertWorkflowAuthoringSources, withWorkflowAuthoringSourceReview } from "../workflows/workflow-authoring-sources.js";

/** Canonical Artifact copies retain the actual workflow owners, independent of
 * continued existence of the replay/child runs. IDs never grant a current read. */
export async function assertArtifactWorkflowSources(db: Db, companyId: string, artifactId: string,
  actor?: AuthorizationActor, readScope?: NativeReadScope) {
  return withWorkflowAuthoringSourceReview(async () => {
    const read = () => db.select({ origin: automationArtifacts.originWorkflowId, refs: automationArtifacts.authoringSourceWorkflowIds }).from(automationArtifacts)
      .where(and(eq(automationArtifacts.companyId, companyId), eq(automationArtifacts.id, artifactId)));
    const [source] = await read();
    const refs = z.array(z.uuid()).max(32).safeParse(source?.refs);
    if (!source || !refs.success || new Set(refs.data).size !== refs.data.length)
      throw forbidden("Complete Artifact workflow source history is unavailable");
    for (const id of new Set([...(source.origin ? [source.origin] : []), ...refs.data]))
      await assertWorkflowAuthoringSources(db, companyId, id, actor, readScope);
    const [current] = await read();
    if (JSON.stringify(current) !== JSON.stringify(source)) throw forbidden("Current Artifact workflow sources changed");
  });
}
