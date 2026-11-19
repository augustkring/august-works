import {randomUUID} from "node:crypto";
import {describe,it,expect,vi} from "vitest";
import {nativeStageCommentApiCallSchema,nativeStageCommentApiToolDefinition,nativeStageCommentApiJsonSchema,nativeStageCommentApiDecisionCurrent} from "./native-stage-comment-api.js";
import {isApprovalReviewComment} from "./issue-execution-policy.js";
import {nativeSha256} from "./native-runtime/canonical.js";
import {Ajv2020} from "ajv/dist/2020.js";

describe("closed declared Stage comment API profile",()=>{
  it("accepts only the exact operation, Task path and a bounded body-only comment",()=>{
    const call={operationId:"POST /api/issues/{id}/comments",pathParams:{id:randomUUID()},body:{body:"Approved: the verification evidence is sufficient."}};
    expect(nativeStageCommentApiCallSchema.parse(call)).toEqual(call);
    for(const changed of [
      {...call,operationId:"PATCH /api/issues/{id}"},
      {...call,query:{}},{...call,files:[]},{...call,contentType:"application/json"},
      {...call,pathParams:{...call.pathParams,companyId:randomUUID()}},
      ...["authorType","authorAgentId","onBehalfOfUserId","metadata","presentation","attachmentIds","reopen","resume","interrupt"].map(key=>
        ({...call,body:{...call.body,[key]:"forbidden"}})),
      {...call,body:{body:""}},{...call,body:{body:"x".repeat(16001)}},
    ])expect(nativeStageCommentApiCallSchema.safeParse(changed).success).toBe(false);
    const schema=nativeStageCommentApiJsonSchema(call.pathParams.id);
    expect(JSON.stringify(schema)).toContain(`"const":"${call.pathParams.id}"`);
  });
  it("refuses ordinary or negated approval text before any Task/HTTP work",async()=>{
    const select=vi.fn(()=>{throw new Error("ordinary comment must not query or dispatch")});
    const db={select} as unknown as Parameters<typeof nativeStageCommentApiDecisionCurrent>[0];
    const binding={companyId:randomUUID(),issueId:randomUUID(),runId:randomUUID(),agentId:randomUUID()};
    for(const body of ["Ordinary progress note","Approved: plain prose is not a decision prefix","## Review: NOT APPROVED","## Review: CHANGES REQUESTED"]){
      expect(await nativeStageCommentApiDecisionCurrent(db,{...binding,arguments:{operationId:"POST /api/issues/{id}/comments",
        pathParams:{id:binding.issueId},body:{body}}})).toBe(false);
    }
    expect(select).not.toHaveBeenCalled();
    expect(isApprovalReviewComment("## Review: APPROVED\nVerified the result.")).toBe(true);
    expect(isApprovalReviewComment("kind: review\ndecision: approved")).toBe(true);
  });
  it("leaves every ordinary Project catalog byte unchanged and appends only a disjoint Stage schema",()=>{
    const project={name:"call_api",description:"Existing Project GET and POST profile",inputSchema:{type:"object",additionalProperties:false,
      properties:{operationId:{type:"string",enum:["GET /api/projects/{id}","POST /api/companies/{companyId}/projects"]}},required:["operationId","pathParams"]}};
    const before=JSON.stringify(project),hash=nativeSha256(project);
    expect(nativeStageCommentApiToolDefinition(project,null)).toBe(project);
    expect(JSON.stringify(nativeStageCommentApiToolDefinition(project,null))).toBe(before);
    expect(nativeSha256(nativeStageCommentApiToolDefinition(project,null))).toBe(hash);
    const stage=nativeStageCommentApiToolDefinition(project,randomUUID());
    expect((stage.inputSchema as {allOf:Array<{oneOf:unknown[]}>}).allOf[0]!.oneOf[0]).toBe(project.inputSchema);
    expect(JSON.stringify(project)).toBe(before);
    expect(nativeSha256(stage)).not.toBe(hash);
  });
  // MS1f phase 4 (a1). The managed OpenCode request completes a top-level object
  // schema lacking `properties`/`additionalProperties`; the Stage schema now
  // carries both and moves the profile union under `allOf`, so the provider
  // copy equals the catalog, while the runner's validator (Ajv 2020, as in
  // `tool-input-schema-validator.ts`) accepts exactly what the old schema did.
  it("accepts exactly the inputs of the old top-level oneOf schema and needs no provider completion",()=>{
    const issueId=randomUUID(),companyId=randomUUID(),projectId=randomUUID();
    const ordinary={type:"object",additionalProperties:false,required:["operationId","pathParams"],properties:{
      operationId:{type:"string",enum:["GET /api/projects/{id}","POST /api/companies/{companyId}/projects","POST /api/issues/{id}/comments"]},
      pathParams:{type:"object",additionalProperties:false,properties:{id:{type:"string",format:"uuid"},companyId:{type:"string",format:"uuid"}}},
      body:{type:"object",additionalProperties:false,required:["name","idempotencyKey"],properties:{
        name:{type:"string",minLength:1,maxLength:200},idempotencyKey:{type:"string",minLength:1,maxLength:255}}}}};
    const tool={name:"call_api",description:"Use only these authenticated API operations.",inputSchema:ordinary};
    const stageSchema=nativeStageCommentApiToolDefinition(tool,issueId).inputSchema as Record<string,unknown>;
    const oldSchema={type:"object",oneOf:[ordinary,nativeStageCommentApiJsonSchema(issueId)]};
    expect(stageSchema).toMatchObject({type:"object",additionalProperties:false,
      properties:{operationId:{type:"string"},pathParams:{type:"object"},body:{type:"object"}}});
    expect(stageSchema).not.toHaveProperty("oneOf");
    // The provider's completion (add `properties: {}` / `additionalProperties: false` when absent) is identity.
    const completed={...stageSchema,...(Object.hasOwn(stageSchema,"properties")?{}:{properties:{}}),
      ...(Object.hasOwn(stageSchema,"additionalProperties")?{}:{additionalProperties:false})};
    expect(completed).toEqual(stageSchema);
    const ajv=new Ajv2020({allErrors:true,strict:false});
    const before=ajv.compile(oldSchema),after=ajv.compile(stageSchema);
    const comment={operationId:"POST /api/issues/{id}/comments",pathParams:{id:issueId},body:{body:"## Review: APPROVED\nChecked."}};
    const accepted=[comment,{operationId:"GET /api/projects/{id}",pathParams:{id:projectId}},
      {operationId:"POST /api/companies/{companyId}/projects",pathParams:{companyId},body:{name:"P",idempotencyKey:"k"}},
      {operationId:"POST /api/issues/{id}/comments",pathParams:{id:projectId}}];
    const refused=[{...comment,query:{}},{...comment,files:[]},{...comment,pathParams:{id:randomUUID()},body:{body:"x"}},
      {...comment,body:{body:""}},{...comment,body:{body:"x".repeat(16001)}},{...comment,body:{body:"x",metadata:{}}},
      {...comment,body:{body:"x",name:"P",idempotencyKey:"k"}},{...comment,operationId:"PATCH /api/issues/{id}"},
      {operationId:"GET /api/projects/{id}"},{operationId:"GET /api/projects/{id}",pathParams:{id:projectId},extra:true},
      {operationId:"POST /api/companies/{companyId}/projects",pathParams:{companyId},body:{name:"P"}},
      {operationId:"GET /api/projects/{id}",pathParams:{id:projectId,other:"x"}},null,[],"call",{}];
    for(const value of accepted){expect(before(value)).toBe(true);expect(after(value)).toBe(true);}
    for(const value of refused){expect(before(value)).toBe(false);expect(after(value)).toBe(false);}
  });
});
