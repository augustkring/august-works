import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, startEmbeddedPostgresTestDatabase } from "./test-embedded-postgres.js";

describe("Original Context Memory roots retain the exact selected body closure",()=>{
  let database:Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,db:ReturnType<typeof postgres>;
  const companyId=randomUUID(),foreignCompanyId=randomUUID(),agentId=randomUUID();
  beforeAll(async()=>{
    database=await startEmbeddedPostgresTestDatabase("context-memory-root-snapshot-");
    db=postgres(database.connectionString,{max:3,onnotice:()=>{}});
    await db`insert into companies(id,name,issue_prefix) values(${companyId},'Root fixture',${randomUUID()}),(${foreignCompanyId},'Foreign root fixture',${randomUUID()})`;
    const identity=randomUUID();
    await db`insert into agent_identities(id,name,home_company_id) values(${identity},'Root persona',${companyId})`;
    await db`insert into agents(id,company_id,agent_identity_id,name) values(${agentId},${companyId},${identity},'Root presence')`;
  },EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async()=>{await db?.end();await database?.cleanup();},30000);

  // Source-free structural binding fixtures; no producer completeness or
  // permission is inferred from these canonical database envelope hashes.
  async function memory(cid=companyId){
    const bindingId=randomUUID(),id=randomUUID();
    await db`insert into memory_bindings(id,company_id,key,name,provider_key)
      values(${bindingId},${cid},${randomUUID()},'Root source binding','local')`;
    await db`insert into memory_records(id,company_id,binding_id,provider_key,memory_type,scope_type,content,observed_at,
      created_by_actor_type,created_by_actor_id,payload_source_protocol_version,updated_at)
      values(${id},${cid},${bindingId},'local','lesson','company','Actual selected Memory body',now(),'system','root-fixture',1,
        '2026-10-23T01:02:03.123456Z'::timestamptz)`;
    const [sealed]=await db`with content as (select jsonb_build_object('version',1,
        'owner',jsonb_build_object('kind','memory_record','companyId',company_id::text,'id',id::text,
          'contentHash',public.aw_native_payload_body_hash('memory_record',to_jsonb(r))),
        'policy',jsonb_build_object('issueIds','[]'::jsonb,'projectIds','[]'::jsonb,'runIds','[]'::jsonb,
          'memoryIds','[]'::jsonb,'foundationRevisionIds','[]'::jsonb),'inputs','[]'::jsonb) as value
        from memory_records r where id=${id})
      update memory_records set payload_source_snapshot=value || jsonb_build_object('digest',encode(sha256(convert_to(value::text,'UTF8')),'hex'))
        from content where id=${id} returning payload_source_snapshot as snapshot,updated_at`;
    return {id,snapshot:sealed!.snapshot,version:(sealed!.updated_at as Date).toISOString()};
  }
  async function manifest(){
    const id=randomUUID();
    await db`insert into context_manifests(id,company_id,agent_id,query_hash,policy_snapshot_hash)
      values(${id},${companyId},${agentId},${"a".repeat(64)},${"b".repeat(64)})`;
    return id;
  }
  async function insert(source:Awaited<ReturnType<typeof memory>>,snapshot=source.snapshot,version=source.version){
    const manifestId=await manifest();
    await db`insert into context_manifest_memory_roots(company_id,manifest_id,memory_record_id,source_version,payload_source_snapshot)
      values(${companyId},${manifestId},${source.id},${version},${snapshot===null?null:db.json(snapshot)})`;
    return manifestId;
  }

  it("matches the actual same-company snapshot and existing millisecond ISO version",async()=>{
    const source=await memory();
    expect(source.version).toBe("2026-10-23T01:02:03.123Z");
    const manifestId=await insert(source);
    const [saved]=await db`select * from context_manifest_memory_roots where manifest_id=${manifestId}`;
    expect(saved!.payload_source_snapshot).toEqual(source.snapshot);
    await expect(insert(source,source.snapshot,"2026-10-23T01:02:03.123456Z")).rejects.toMatchObject({code:"23514"});
    await expect(insert(source,source.snapshot,"2026-10-23T01:02:03.124Z")).rejects.toMatchObject({code:"23514"});
  });
  it("rejects a copied foreign or different Memory snapshot and missing sources",async()=>{
    const source=await memory(),other=await memory(),foreign=await memory(foreignCompanyId);
    for(const snapshot of [other.snapshot,foreign.snapshot,{...source.snapshot,digest:"0".repeat(64)}])
      await expect(insert(source,snapshot)).rejects.toMatchObject({code:"23514"});
    await expect(insert(foreign)).rejects.toMatchObject({code:"23503"});
    await expect(insert({...source,id:randomUUID()})).rejects.toMatchObject({code:"23503"});
  });
  it("makes every root field immutable while allowing exact no-op updates",async()=>{
    const source=await memory(),manifestId=await insert(source);
    await db`update context_manifest_memory_roots set source_version=source_version,payload_source_snapshot=payload_source_snapshot
      where manifest_id=${manifestId}`;
    for(const change of [db`update context_manifest_memory_roots set source_version='later' where manifest_id=${manifestId}`,
      db`update context_manifest_memory_roots set payload_source_snapshot=null where manifest_id=${manifestId}`,
      db`update context_manifest_memory_roots set memory_record_id=${randomUUID()} where manifest_id=${manifestId}`,
      db`update context_manifest_memory_roots set company_id=${foreignCompanyId} where manifest_id=${manifestId}`,
      db`update context_manifest_memory_roots set manifest_id=${randomUUID()} where manifest_id=${manifestId}`])
      await expect(change).rejects.toMatchObject({code:"23514"});
  });
  it("keeps NULL historical/hash-version roots unknown and refuses upgrading them",async()=>{
    const source=await memory(),manifestId=await insert(source,null,"legacy-analytical-content-hash");
    await expect(db`update context_manifest_memory_roots set payload_source_snapshot=${db.json(source.snapshot)},source_version=${source.version}
      where manifest_id=${manifestId}`).rejects.toMatchObject({code:"23514"});
    const [saved]=await db`select * from context_manifest_memory_roots where manifest_id=${manifestId}`;
    expect(saved!.payload_source_snapshot).toBeNull();
    expect(saved!.source_version).toBe("legacy-analytical-content-hash");
  });
  it("retains the selected snapshot after later source edits and physical erasure",async()=>{
    const source=await memory(),manifestId=await insert(source);
    await db`update memory_records set content='Later source body',payload_source_snapshot=null,updated_at=now() where id=${source.id}`;
    const [afterEdit]=await db`select * from context_manifest_memory_roots where manifest_id=${manifestId}`;
    expect(afterEdit!.payload_source_snapshot).toEqual(source.snapshot);
    await expect(insert(source)).rejects.toMatchObject({code:"23514"});
    await db`delete from memory_records where id=${source.id}`;
    const [retained]=await db`select * from context_manifest_memory_roots where manifest_id=${manifestId}`;
    expect(retained!.memory_record_id).toBe(source.id);
    expect(retained!.payload_source_snapshot).toEqual(source.snapshot);
    await db`delete from context_manifests where id=${manifestId}`;
    expect(await db`select * from context_manifest_memory_roots where manifest_id=${manifestId}`).toHaveLength(0);
  });
});
