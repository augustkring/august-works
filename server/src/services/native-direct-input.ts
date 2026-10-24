import { sql } from "drizzle-orm";
import { issues, projects, issueComments, type Db } from "@paperclipai/db";
import type { NativePayloadSourceSnapshot } from "@paperclipai/shared";
import { forbidden } from "../errors.js";
import type { AuthorizationActor } from "./authorization.js";

type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Used only after the original owner admits an independent direct Human
 * input. This expression binds bytes; it supplies no permission or completeness. */
export function directHumanPayloadSnapshotSql(kind: "issue" | "project" | "comment") {
  const table = kind === "issue" ? issues : kind === "project" ? projects : issueComments;
  const issuePolicy = kind === "comment" ? sql`jsonb_build_array(${issueComments.issueId}::text)` : sql`'[]'::jsonb`;
  return sql<NativePayloadSourceSnapshot>`(
    with payload as (select jsonb_build_object('version',1,'owner',jsonb_build_object(
      'kind',${kind}::text,'companyId',${table.companyId}::text,'id',${table.id}::text,
      'contentHash',public.aw_native_payload_body_hash(${kind}::text,to_jsonb(${table}))),
      'policy',jsonb_build_object('issueIds',${issuePolicy},'projectIds','[]'::jsonb,'runIds','[]'::jsonb,
        'memoryIds','[]'::jsonb,'foundationRevisionIds','[]'::jsonb),'inputs','[]'::jsonb) as value)
    select value || jsonb_build_object('digest',encode(sha256(convert_to(value::text,'UTF8')),'hex')) from payload
  )`;
}

/** The caller retains its actual native User/session pins until commit. */
export async function assertDirectInputSessionCurrent(tx: Transaction, actor: AuthorizationActor, expiresAt: number) {
  const [current] = await tx.execute<{ active: boolean }>(sql`select
    ${expiresAt}::double precision>extract(epoch from clock_timestamp())*1000
    and not exists(select 1 from account_deletion_operations where user_id=${actor.userId}) as active`);
  if (!current?.active) throw forbidden("The current manual input session is unavailable");
}
