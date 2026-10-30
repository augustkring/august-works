import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, startEmbeddedPostgresTestDatabase } from "./test-embedded-postgres.js";

describe("Original run input receipt database binding", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof postgres>;
  const companyId=randomUUID(), agentId=randomUUID(), foreignCompanyId=randomUUID();
  const alice="receipt-alice", bob="receipt-bob";
  const policy=()=>({issueIds:[],projectIds:[],runIds:[],memoryIds:[],foundationRevisionIds:[]});
  // Deliberately structural JSON: no native provider input/dispatch qualification.
  const execution={version:1,fixture:"Exact original structural bootstrap"};
  type Receipt = Record<string,any>;
  beforeAll(async()=>{
    database=await startEmbeddedPostgresTestDatabase("native-run-receipt-");
    db=postgres(database.connectionString,{max:1,onnotice:()=>{}});
    await db`insert into companies(id,name,issue_prefix) values(${companyId},'Receipt fixture',${randomUUID()}),(${foreignCompanyId},'Foreign fixture',${randomUUID()})`;
    const identity=randomUUID();
    await db`insert into agent_identities(id,name,home_company_id) values(${identity},'Receipt persona',${companyId})`;
    await db`insert into agents(id,company_id,agent_identity_id,name) values(${agentId},${companyId},${identity},'Receipt worker')`;
  },EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async()=>{await db?.end();await database?.cleanup();},30000);

  async function digest(value:unknown){
    const [row]=await db`select encode(sha256(convert_to((${db.json(value as any)}::jsonb)::text,'UTF8')),'hex') as digest`;
    return row!.digest as string;
  }
  async function sign(receipt:Receipt){
    const {digest:ignored,...body}=receipt;
    return {...body,digest:await digest(body)} as Receipt;
  }
  async function insert(protocol=1, profile:Parameters<typeof db.json>[0]|null=null, mode="native", issueId:string|null=null){
    const [row]=await db`insert into heartbeat_runs(company_id,agent_id,responsible_user_id,native_input_source_protocol_version,runtime_mode,native_issue_id,runner_profile_json)
      values(${companyId},${agentId},${alice},${protocol},${mode},${issueId},${profile===null?null:db.json(profile)}) returning *`;
    return row!;
  }
  async function receiptFor(row:Receipt,changes:Receipt={}){
    return sign({version:1,binding:{companyId,runId:row.id,agentId,responsibleUserId:alice,issueId:row.issue_id},
      bootstrap:{executionInputDigest:await digest(execution),policy:policy(),inputs:[]},dispatches:[],additionalInputs:[],...changes});
  }
  async function write(row:Receipt,receipt:Receipt,extra:Receipt={}){
    const [updated]=await db`update heartbeat_runs set runner_profile_json=${db.json({nativeExecutionInput:execution,nativeInputSourceReceipt:receipt,...extra})}
      where id=${row.id} returning *`;
    return updated!;
  }
  async function captured(){const row=await insert();const receipt=await receiptFor(row);await write(row,receipt);return {row,receipt};}
  const denied={code:"23514"};

  it("binds the first canonical input and receipt while allowing ordinary profile merges",async()=>{
    const {row,receipt}=await captured();
    const updated=await write(row,receipt,{sessionCheckpoint:{fixture:"Later operational checkpoint"}});
    expect(updated.runner_profile_json.nativeInputSourceReceipt).toEqual(receipt);
    expect(updated.source_context_provenance_qualified).toBe(false);
    const id=randomUUID();
    const insertedReceipt=await receiptFor({id,issue_id:null});
    await db`insert into heartbeat_runs(id,company_id,agent_id,responsible_user_id,native_input_source_protocol_version,runtime_mode,runner_profile_json)
      values(${id},${companyId},${agentId},${alice},1,'native',${db.json({nativeExecutionInput:execution,nativeInputSourceReceipt:insertedReceipt})})`;
  });

  it("installs a first receipt only beside a pre-turn input intent and appends a source set only after its exact acknowledgement",async()=>{
    // This DB-contract fixture exercises integrity and ordering only; it does
    // not claim that its structural source is a real provider input.
    const runId=randomUUID(), issueId=randomUUID(), dispatchId=randomUUID(), eventSeq=17, attempt=2;
    const boundExecution={...execution,binding:{companyId,runId,agentId,issueId}};
    await db`insert into issues(id,company_id,title) values(${issueId},${companyId},'Intent owner')`;
    const [row]=await db`insert into heartbeat_runs(id,company_id,agent_id,responsible_user_id,native_input_source_protocol_version,runtime_mode,status,native_issue_id,runner_profile_json)
      values(${runId},${companyId},${agentId},${alice},0,'native','running',${issueId},${db.json({nativeExecutionInput:boundExecution})}) returning *`;
    const turnInputDigest=await digest({message:{role:"user",text:"exact rendered frame"}});
    const intent={dispatchId,eventSeq,attempt,responsibleUserId:alice,turnInputDigest,byteSize:40,continuation:false};
    const receipt=await receiptFor(row!,{binding:{companyId,runId,agentId,responsibleUserId:alice,issueId},
      bootstrap:{executionInputDigest:await digest(boundExecution),policy:policy(),inputs:[{kind:"task",issueId,sourceVersion:"1",contentHash:"a".repeat(64)}]},
      dispatches:[],additionalInputs:[]});
    const profile={nativeExecutionInput:boundExecution,nativeInputSourceReceipt:receipt,nativeModelInputDispatchIntents:[intent]};
    await db`update heartbeat_runs set runner_profile_json=${db.json(profile)},native_input_source_protocol_version=1 where id=${runId}`;
    const sourceDispatch={executionInputDigest:turnInputDigest,responsibleUserId:alice,policy:policy(),
      inputs:[{kind:"task",issueId,sourceVersion:"1",contentHash:"a".repeat(64)}]};
    const acknowledgedProfile={...profile,nativeModelInputDispatchIntents:[{...intent,turnId:"actual-turn-17"}],
      nativeInputSourceReceipt:await sign({...receipt,dispatches:[sourceDispatch]})};
    await db`update heartbeat_runs set runner_profile_json=${db.json(acknowledgedProfile)} where id=${runId}`;
    const [saved]=await db`select runner_profile_json,native_input_source_protocol_version from heartbeat_runs where id=${runId}`;
    expect(saved!.native_input_source_protocol_version).toBe(1);
    expect(saved!.runner_profile_json.nativeInputSourceReceipt.dispatches).toEqual([sourceDispatch]);

    const badRunId=randomUUID();
    const badExecution={...execution,binding:{companyId,runId:badRunId,agentId,issueId}};
    const [badRow]=await db`insert into heartbeat_runs(id,company_id,agent_id,responsible_user_id,native_input_source_protocol_version,runtime_mode,status,native_issue_id,runner_profile_json)
      values(${badRunId},${companyId},${agentId},${alice},0,'native','running',${issueId},${db.json({nativeExecutionInput:badExecution})}) returning *`;
    const badReceipt=await receiptFor(badRow!,{binding:{companyId,runId:badRunId,agentId,responsibleUserId:alice,issueId},
      bootstrap:{executionInputDigest:await digest(badExecution),policy:policy(),inputs:[]}});
    await expect(db`update heartbeat_runs set runner_profile_json=${db.json({nativeExecutionInput:badExecution,nativeInputSourceReceipt:badReceipt})},
      native_input_source_protocol_version=1 where id=${badRunId}`).rejects.toMatchObject(denied);
    const badIntentProfile={nativeExecutionInput:badExecution,nativeInputSourceReceipt:badReceipt,
      nativeModelInputDispatchIntents:[{...intent,dispatchId:randomUUID(),turnId:"actual-turn"}]};
    await expect(db`update heartbeat_runs set runner_profile_json=${db.json(badIntentProfile)},native_input_source_protocol_version=1 where id=${badRunId}`)
      .rejects.toMatchObject(denied);
  });

  it("rejects mismatched owner, Human, input digest and receipt digest",async()=>{
    const row=await insert(), original=await receiptFor(row);
    for(const binding of [{companyId:foreignCompanyId},{runId:randomUUID()},{agentId:randomUUID()},{issueId:randomUUID()},{responsibleUserId:bob}]){
      await expect(write(row,await sign({...original,binding:{...original.binding,...binding}}))).rejects.toMatchObject(denied);
    }
    await expect(write(row,await sign({...original,bootstrap:{...original.bootstrap,executionInputDigest:"0".repeat(64)}}))).rejects.toMatchObject(denied);
    await expect(write(row,{...original,digest:"0".repeat(64)})).rejects.toMatchObject(denied);
    const other=await insert(0);
    await expect(write(other,await receiptFor(other))).rejects.toMatchObject(denied);
    const legacy=await insert(1,null,"legacy");
    await expect(write(legacy,await receiptFor(legacy))).rejects.toMatchObject(denied);
  });

  it("refuses adopting old or explicitly unknown native input history",async()=>{
    for(const input of [execution,null]){
      const row=await insert(1,{nativeExecutionInput:input});
      await expect(write(row,await receiptFor(row))).rejects.toMatchObject(denied);
    }
    const {row,receipt}=await captured();
    await expect(db`update heartbeat_runs set runner_profile_json='{}'::jsonb where id=${row.id}`).rejects.toMatchObject(denied);
    await expect(write(row,receipt,{nativeExecutionInput:{...execution,fixture:"Replacement"}})).rejects.toMatchObject(denied);
    await expect(write(row,await sign({...receipt,bootstrap:{...receipt.bootstrap,policy:{...policy(),memoryIds:[randomUUID()]}}}))).rejects.toMatchObject(denied);
    await expect(db`update heartbeat_runs set runtime_mode='legacy' where id=${row.id}`).rejects.toMatchObject(denied);
  });

  it("retains historical Human captures through steering and validates every appended entry",async()=>{
    const {row,receipt}=await captured();
    const firstFrame={message:{role:"user",text:"Alice exact dispatched frame"}};
    const firstDispatchId=randomUUID();
    const firstFrameDigest=await digest(firstFrame);
    const first=await sign({...receipt,dispatches:[{executionInputDigest:firstFrameDigest,responsibleUserId:alice,policy:policy(),inputs:[]}]});
    const firstIntent={dispatchId:firstDispatchId,eventSeq:17,attempt:1,responsibleUserId:alice,turnInputDigest:firstFrameDigest,
      byteSize:Buffer.byteLength(JSON.stringify(firstFrame)),continuation:false,turnId:"ack-alice"};
    await write(row,first,{nativeModelInputDispatchIntents:[firstIntent]});
    await db`update heartbeat_runs set responsible_user_id=${bob} where id=${row.id}`;
    const secondFrame={message:{role:"user",text:"Bob exact dispatched frame"}};
    const secondFrameDigest=await digest(secondFrame);
    const secondIntent={dispatchId:randomUUID(),eventSeq:17,attempt:2,responsibleUserId:bob,turnInputDigest:secondFrameDigest,
      byteSize:Buffer.byteLength(JSON.stringify(secondFrame)),continuation:false,turnId:"ack-bob"};
    const next=await sign({...first,dispatches:[...first.dispatches,{executionInputDigest:secondFrameDigest,responsibleUserId:bob,policy:policy(),inputs:[]}],
      additionalInputs:[{responsibleUserId:bob,policy:policy(),inputs:[]}]});
    await write(row,next,{nativeModelInputDispatchIntents:[firstIntent,secondIntent]});
    for(const replacement of [
      {...next,binding:{...next.binding,responsibleUserId:bob}},
      {...next,dispatches:next.dispatches.slice(1)},
      {...next,dispatches:[...next.dispatches].reverse()},
      {...next,dispatches:[{...next.dispatches[0],responsibleUserId:bob},next.dispatches[1]]},
      {...next,additionalInputs:[]},
      {...next,additionalInputs:[...next.additionalInputs,{responsibleUserId:alice,policy:policy(),inputs:[]}]},
      {...next,dispatches:[...next.dispatches,{executionInputDigest:await digest(execution),responsibleUserId:alice,policy:policy(),inputs:[]}]},
    ])await expect(write(row,await sign(replacement))).rejects.toMatchObject(denied);
    const [saved]=await db`select runner_profile_json,responsible_user_id from heartbeat_runs where id=${row.id}`;
    expect(saved!.responsible_user_id).toBe(bob);
    expect(saved!.runner_profile_json.nativeInputSourceReceipt).toEqual(next);
  });

  it("requires empty initial event history and rejects malformed closed shapes and bounds",async()=>{
    const row=await insert(), receipt=await receiptFor(row);
    const additional={responsibleUserId:alice,policy:policy(),inputs:[]};
    const dispatch={...additional,executionInputDigest:await digest(execution)};
    for(const invalid of [
      {...receipt,version:2}, {...receipt,unknown:true}, {...receipt,binding:{...receipt.binding,unknown:true}},
      {...receipt,bootstrap:{...receipt.bootstrap,unknown:true}},
      {...receipt,bootstrap:{...receipt.bootstrap,inputs:null}},
      {...receipt,bootstrap:{...receipt.bootstrap,policy:{...policy(),memoryIds:null}}},
      {...receipt,bootstrap:{...receipt.bootstrap,inputs:[{kind:"tool_result",payload:"x".repeat(2097152)}]}},
      {...receipt,dispatches:[dispatch]}, {...receipt,additionalInputs:[additional]},
    ])await expect(write(row,await sign(invalid))).rejects.toMatchObject(denied);
    await write(row,receipt);
    for(const invalid of [
      {...receipt,dispatches:Array.from({length:65},()=>dispatch)},
      {...receipt,additionalInputs:Array.from({length:257},()=>additional)},
      {...receipt,additionalInputs:[{...additional,extra:true}]},
      {...receipt,additionalInputs:[{...additional,policy:{...policy(),memoryIds:Array.from({length:257},()=>randomUUID())}}]},
      {...receipt,additionalInputs:[{...additional,policy:{...policy(),memoryIds:Array.from({length:256},()=>randomUUID())}},{...additional,policy:{...policy(),memoryIds:[randomUUID()]}}]},
    ])await expect(write(row,await sign(invalid))).rejects.toMatchObject(denied);
  });

  it("binds the explicit native Task before the original source trigger fills derived issue scope",async()=>{
    const issueId=randomUUID();
    await db`insert into issues(id,company_id,title) values(${issueId},${companyId},'Run binding source')`;
    const id=randomUUID(), receipt=await receiptFor({id,issue_id:issueId});
    const [row]=await db`insert into heartbeat_runs(id,company_id,agent_id,responsible_user_id,native_input_source_protocol_version,runtime_mode,native_issue_id,context_snapshot,runner_profile_json)
      values(${id},${companyId},${agentId},${alice},1,'native',${issueId},${db.json({issueId})},${db.json({nativeExecutionInput:execution,nativeInputSourceReceipt:receipt})}) returning issue_id`;
    expect(row!.issue_id).toBe(issueId);
    // Derived scope alone must never supply the canonical Native Task binding.
    const derivedOnlyId=randomUUID(), derivedOnlyReceipt=await receiptFor({id:derivedOnlyId,issue_id:issueId});
    await expect(db`insert into heartbeat_runs(id,company_id,agent_id,responsible_user_id,native_input_source_protocol_version,runtime_mode,context_snapshot,runner_profile_json)
      values(${derivedOnlyId},${companyId},${agentId},${alice},1,'native',${db.json({issueId})},${db.json({nativeExecutionInput:execution,nativeInputSourceReceipt:derivedOnlyReceipt})})`)
      .rejects.toMatchObject(denied);
  });

  it("permits only marker-backed whole-profile erasure and forbids resurrection",async()=>{
    for(const clear of [null,{}]){
      const {row,receipt}=await captured();
      await db`insert into memory_deletion_markers(company_id,kind,key) values(${foreignCompanyId},'source',${`memory-run-source-erasure:v1:${row.id}`})`;
      await expect(db`update heartbeat_runs set runner_profile_json=${clear===null?null:db.json(clear)} where id=${row.id}`).rejects.toMatchObject(denied);
      await db`insert into memory_deletion_markers(company_id,kind,key) values(${companyId},'source',${`memory-run-source-erasure:v1:${row.id}`})`;
      await expect(db`update heartbeat_runs set runner_profile_json=${db.json({sessionCheckpoint:{kept:true}})} where id=${row.id}`).rejects.toMatchObject(denied);
      await db`update heartbeat_runs set runner_profile_json=${clear===null?null:db.json(clear)} where id=${row.id}`;
      await expect(write(row,receipt)).rejects.toMatchObject(denied);
      await expect(db`update heartbeat_runs set runner_profile_json=${db.json({nativeExecutionInput:execution})} where id=${row.id}`).rejects.toMatchObject(denied);
      const [saved]=await db`select runner_profile_json from heartbeat_runs where id=${row.id}`;
      // The original workflow erasure owner normalizes even {} to SQL NULL.
      expect(saved!.runner_profile_json).toBeNull();
    }
  });
  it("preserves original source-version erasure and stamps durable run erasure before any resurrection",async()=>{
    const {row,receipt}=await captured();
    const runMarker=`memory-run-source-erasure:v1:${row.id}`;
    const [initial]=await db`select public.aw_workflow_memory_erased(${companyId}::uuid,${row.id}::uuid,null) as erased`;
    expect(initial!.erased).toBe(false);
    await db`insert into memory_deletion_markers(company_id,kind,key)
      values(${companyId},'source',${`native-runtime-source-version-erasure:v1:${row.id}:${randomUUID()}`})`;
    const [canonical]=await db`select public.aw_workflow_memory_erased(${companyId}::uuid,${row.id}::uuid,null) as erased`;
    expect(canonical!.erased).toBe(true);
    expect(await db`select key from memory_deletion_markers where company_id=${companyId} and key=${runMarker}`).toHaveLength(0);
    // This ordinary merge must reach the original erasure trigger, not fail
    // merely because the run-specific marker was not stamped beforehand.
    const updated=await write(row,receipt,{sessionCheckpoint:{fixture:"Operational update under actual source erasure"}});
    expect(updated.runner_profile_json).toBeNull();
    expect(await db`select key from memory_deletion_markers where company_id=${companyId} and kind='source' and key=${runMarker}`).toHaveLength(1);
    await db`delete from memory_deletion_markers where company_id=${companyId}
      and key like ${`native-runtime-source-version-erasure:v1:${row.id}:%`}`;
    await expect(write(row,receipt)).rejects.toMatchObject(denied);
  });
});
