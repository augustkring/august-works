import {randomUUID} from "node:crypto";
import {describe,it,expect,vi} from "vitest";
import {nativeStageCommentApiCallSchema,nativeStageCommentApiToolDefinition,nativeStageCommentApiJsonSchema,nativeStageCommentApiDecisionCurrent} from "./native-stage-comment-api.js";
import {isApprovalReviewComment} from "./issue-execution-policy.js";
import {nativeSha256} from "./native-runtime/canonical.js";

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
    expect((stage.inputSchema as {oneOf:unknown[]}).oneOf[0]).toBe(project.inputSchema);
    expect(JSON.stringify(project)).toBe(before);
    expect(nativeSha256(stage)).not.toBe(hash);
  });
});
