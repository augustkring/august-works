import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { NativeRunInputSourceReceipt } from "@paperclipai/shared";
import { nativeRunInputSourceReceiptPrefix, nativeRunInputSourceReceiptPrefixMatches } from "./native-stage-task-body-source.js";

const emptyPolicy={issueIds:[],projectIds:[],runIds:[],memoryIds:[],foundationRevisionIds:[]};
const taskSet=(issueId:string,version:string,contentHash:string)=>({policy:emptyPolicy,
  inputs:[{kind:"task" as const,issueId,sourceVersion:version,contentHash}]});
function pgJsonb(value:unknown):string{
  if(Array.isArray(value)) return `[${value.map(pgJsonb).join(", ")}]`;
  if(value && typeof value==="object") return `{${Object.entries(value).sort(([a],[b])=>Buffer.byteLength(a)-Buffer.byteLength(b)||Buffer.compare(Buffer.from(a),Buffer.from(b)))
    .map(([key,item])=>`${JSON.stringify(key)}: ${pgJsonb(item)}`).join(", ")}}`;
  return JSON.stringify(value)??"null";
}
const pgDigest=(value:Record<string,unknown>)=>createHash("sha256").update(pgJsonb(Object.fromEntries(Object.entries(value).filter(([key])=>key!=="digest")))).digest("hex");
function receiptFixture():NativeRunInputSourceReceipt{
  const companyId=randomUUID(),runId=randomUUID(),agentId=randomUUID(),issueId=randomUUID(),human="source-owner-human";
  const first=taskSet(issueId,"source-v1","a".repeat(64));
  const second=taskSet(randomUUID(),"source-v2","b".repeat(64));
  const original={version:1 as const,binding:{companyId,runId,agentId,responsibleUserId:human,issueId},
    bootstrap:{executionInputDigest:"c".repeat(64),...taskSet(issueId,"bootstrap-v1","d".repeat(64))},
    dispatches:[{executionInputDigest:"e".repeat(64),responsibleUserId:human,...first}],
    additionalInputs:[{responsibleUserId:human,...second}],digest:""};
  original.digest=pgDigest(original);
  const appended={...original,dispatches:[...original.dispatches,{executionInputDigest:"f".repeat(64),responsibleUserId:human,...taskSet(randomUUID(),"dispatch-v2","1".repeat(64))}],
    additionalInputs:[...original.additionalInputs,{responsibleUserId:human,...taskSet(randomUUID(),"later-input","2".repeat(64))}],digest:""};
  appended.digest=pgDigest(appended);
  return appended;
}

describe("Native Stage input-receipt prefix",()=>{
  it("keeps receipt key counts on supported guarded PostgreSQL JSONB functions",()=>{
    const migration=readFileSync(new URL("../../../packages/db/src/migrations/0571_issue_native_stage_source_transform.sql",import.meta.url),"utf8");
    const compact=migration.replace(/\s+/g," ");
    expect(compact).not.toMatch(/\bjsonb_object_length\s*\(/i);
    expect(compact).toContain("(CASE WHEN jsonb_typeof(receipt)='object' THEN (SELECT count(*) FROM jsonb_object_keys(receipt)) ELSE -1 END)<>20");
    expect(compact).toContain("(CASE WHEN jsonb_typeof(producer.result_json->'nativeStagePolicyTransitions'->receipt_key)='object' THEN (SELECT count(*) FROM jsonb_object_keys(producer.result_json->'nativeStagePolicyTransitions'->receipt_key)) ELSE -1 END)=19");
    expect(compact).toContain("receipt ?& ARRAY['version','companyId','issueId','runId','agentId','responsibleUserId'");
    expect(compact).toContain("'originalDispatchCount','originalAdditionalInputCount'");
  });
  it("preserves the exact full bootstrap and captured list prefixes across legitimate appends",()=>{
    const current=receiptFixture(),prefix=nativeRunInputSourceReceiptPrefix(current,1,1);
    expect(prefix).toEqual({...current,dispatches:current.dispatches.slice(0,1),additionalInputs:current.additionalInputs.slice(0,1)});
    expect(prefix?.bootstrap).toEqual(current.bootstrap);
    expect(prefix?.binding).toEqual(current.binding);
    expect(prefix?.dispatches).toEqual(current.dispatches.slice(0,1));
    expect(prefix?.additionalInputs).toEqual(current.additionalInputs.slice(0,1));
  });

  it("uses PostgreSQL JSONB digest semantics for the current receipt and exact pinned prefix",async()=>{
    const current=receiptFixture();
    const expectedOriginal={...current,dispatches:current.dispatches.slice(0,1),additionalInputs:current.additionalInputs.slice(0,1)};
    expectedOriginal.digest=pgDigest(expectedOriginal);
    const dbFor=(value:unknown,pinnedDigest:unknown)=>({execute:async(query:{queryChunks?:unknown[]})=>{
      const compiled=new PgDialect().sqlToQuery(query as unknown as SQL);
      expect(compiled.sql).toContain("::jsonb");expect(compiled.sql).toContain("sha256(convert_to(");
      expect(compiled.params).toHaveLength(3);
      const parts=query.queryChunks??[];
      const stringChunks=parts.filter((part):part is {value:unknown[]}=>Boolean(part&&typeof part==="object"&&
        (part as {constructor?:{name?:string}}).constructor?.name==="StringChunk"));
      const text=stringChunks.flatMap(part=>part.value).filter((part):part is string=>typeof part==="string").join("");
      expect(text).toContain("::jsonb");expect(text).toContain("sha256(convert_to(");expect(text).toContain("-'digest'");
      const parameters=parts.filter((part):part is string=>typeof part==="string").map(part=>JSON.parse(part) as Record<string,unknown>);
      expect(parameters).toHaveLength(3);
      const [currentDigestParam,currentHashParam,prefixParam]=parameters;
      expect(currentDigestParam).toEqual(currentHashParam);
      expect(currentDigestParam).toBeDefined();expect(prefixParam).toBeDefined();
      expect(prefixParam!.digest).toBe(pinnedDigest);
      return [{currentDigestValid:pgDigest(currentHashParam!)===currentHashParam!.digest,prefixDigest:pgDigest(prefixParam!)}];
    }});
    const matches=(value:unknown,digest:unknown=expectedOriginal.digest,dispatchCount:unknown=1,additionalInputCount:unknown=1)=>
      nativeRunInputSourceReceiptPrefixMatches(dbFor(value,digest) as never,
        {receipt:value,originalDigest:digest,dispatchCount,additionalInputCount});
    expect(await matches(current)).toBe(true);
    expect(await matches(current,current.digest,2,2)).toBe(true);
    const pruned={...current,dispatches:current.dispatches.slice(0,1)};
    pruned.digest=pgDigest(pruned);
    expect(await matches(pruned,current.digest,2,2)).toBe(false);
    const staleReceipt={...current,digest:"a".repeat(64)};
    expect(await matches(staleReceipt)).toBe(false);
    const changedBootstrap={...current,bootstrap:{...current.bootstrap,executionInputDigest:"3".repeat(64)}};
    changedBootstrap.digest=pgDigest(changedBootstrap);
    expect(await matches(changedBootstrap)).toBe(false);
    const reordered={...current,dispatches:[...current.dispatches].reverse()};
    reordered.digest=pgDigest(reordered);
    expect(await matches(reordered)).toBe(false);
    const changedBinding={...current,binding:{...current.binding,responsibleUserId:"different-human"}};
    changedBinding.digest=pgDigest(changedBinding);
    expect(await matches(changedBinding)).toBe(false);
    expect(await matches(current,expectedOriginal.digest,2,1)).toBe(false);
    expect(await matches({...current,unexpected:true})).toBe(false);
    expect(await matches(current,expectedOriginal.digest,1.5,1)).toBe(false);
  });
});
