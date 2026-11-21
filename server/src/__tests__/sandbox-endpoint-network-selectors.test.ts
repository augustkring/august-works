import { readFileSync } from "node:fs";
import { describe,it,expect,vi } from "vitest";
import { SANDBOX_CONTROLS,sandboxCapabilitySnapshotSchema,sandboxHostReplySchema,sandboxNetworkCallerBinariesSchema,type SandboxCapabilitySnapshot } from "@paperclipai/shared";
import { compileSandboxPolicy,type ResolvedSandboxBrokerBinding } from "../services/execution-sandbox/policy-compiler.js";
import { projectOpenShellPolicy } from "../services/execution-sandbox/openshell-policy.js";
import { checkOpenShellBoundary } from "../services/execution-sandbox/openshell-prover.js";
import { nativeSha256 } from "../services/native-runtime/canonical.js";
import { openShellBackend,type OpenShellHostBridge } from "../services/execution-sandbox/openshell-backend.js";
import { createToolGatewayService } from "../services/tool-gateway.js";
import { runtimeControlService } from "../services/runtime/control.js";
import { registerAssignedMcpGateway } from "../services/native-runtime/assigned-mcp-tools.js";
import type { Db } from "@paperclipai/db";
import type { SaasPlatformConfig } from "../saas-platform-config.js";
import { policyFixture } from "./helpers/sandbox-fixture.js";
const origin="https://broker.example.test";
const hostDimensions=["host","port","method","path","binary","company","presence","expiry","revocation"] as const;
function snapshot():SandboxCapabilitySnapshot {
 const fixture=JSON.parse(readFileSync(new URL("./fixtures/openshell-qualification-policy-golden.json",import.meta.url),"utf8")).fixture;
 const target={companyId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",bindingId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",cellId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",cellGeneration:"1",sandboxRef:"aw-v7-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",hostEpoch:1,bindingVersion:1,
  sandboxId:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",containerId:"a".repeat(64),imageDigest:`fixture.invalid/sandbox@sha256:${"a".repeat(64)}`,hostKernelVersion:"protected-test",runtimeBinarySha256:"e".repeat(64),openshellCliSha256:"f".repeat(64),dockerEngineIdHash:"1".repeat(64),policyHash:"2".repeat(64),provisioningHash:"3".repeat(64),
  resourceLimits:{cpuMillis:1000,memoryBytes:268435456,diskBytes:1073741824,pidsLimit:64},policyVersion:1,configRevision:"revision-1",phase:"Ready",mechanism:"openshell_create_sandbox_v0.1.2",probePolicyHash:"4".repeat(64),probeFixtureHash:fixture.fixtureHash};
 return sandboxCapabilitySnapshotSchema.parse({ ...Object.fromEntries(SANDBOX_CONTROLS.map(control=>[control,true])),backend:"openshell",backendVersion:"0.1.2",hostKernelVersion:"protected-test",
  sandboxImageDigest:`fixture.invalid/sandbox@sha256:${"a".repeat(64)}`,filesystemEnforcementMode:"hard_requirement",staticPolicyRequiresRecreate:true,dynamicNetworkPolicy:true,
  policyProverBoundaryCheck:true,policyProverCoverage:[],credentialBindingDimensions:[...hostDimensions],credentialBrokerProviderProfile:{id:"app",hash:"b".repeat(64),origin},
  modelBrokerProviderProfile:{id:"model",hash:"c".repeat(64),origin},testedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),qualificationHash:nativeSha256(target),qualificationTarget:{...target,targetHash:nativeSha256(target)},qualificationProbeFixture:fixture,evidenceKind:"protected_host_report" }) as SandboxCapabilitySnapshot;
}
const connectionId="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", grantVersionHash="a".repeat(64);
function setup() {
 const capabilities=snapshot();
 capabilities.credentialBrokerProviderProfile!.binaries=["/usr/bin/curl"];
 capabilities.modelBrokerProviderProfile!.binaries=["/usr/bin/opencode"];
 const boundary=policyFixture();boundary.process.allowedBinaries=[];boundary.process.allowedSyscalls=[];
 boundary.filesystem={readPaths:["/usr"],writePaths:["/work"],deniedPaths:[]};boundary.network.destinations=[];
 boundary.credentials={mode:"brokered",bindings:[{connectionId,grantVersionHash,hostname:"provider.example.test",port:443,methods:["POST"],pathPrefixes:["/tool"],binary:"/usr/bin/curl",ttlSeconds:60}]};
 const resolved:ResolvedSandboxBrokerBinding={connectionId,grantVersionHash,gatewayPublicId:"gateway_1",endpointPath:"/mcp/gateways/gateway_1",allowedTools:["fixed-read"],binary:"/usr/bin/curl",destination:{hostname:"provider.example.test",port:443,method:"POST",path:"/tool"}};
 return {boundary,candidate:structuredClone(boundary),capabilities,credentialBrokerOrigin:origin,credentialBrokerBindings:[resolved],authorizedConnectionGrantHashes:{[connectionId]:grantVersionHash},sourcePolicyRefs:["manifest:current"]};
}
const projection=(compiled:ReturnType<typeof compileSandboxPolicy>)=>projectOpenShellPolicy(compiled.compiledPolicy,compiled.modelBrokerEndpoint,compiled.credentialBrokerEndpoints);
describe("verified endpoint network callers without a general process allowlist",()=>{
 it("derives distinct exact App/model caller selectors and idempotently recompiles current routes",()=>{
  const input=setup(),first=compileSandboxPolicy(input);expect(first.proverResult).toBe("pass");
  const projected=projection(first);expect(projected.unsupportedFeatures).toEqual([]);
  const routes=Object.values(projected.document.network_policies);
  expect(routes).toHaveLength(2);
  expect(routes.find(route=>route.endpoints[0]!.rules[0]!.allow.path === "/mcp/gateways/gateway_1")!.binaries).toEqual([{path:"/usr/bin/curl"}]);
  expect(routes.find(route=>route.endpoints[0]!.rules[0]!.allow.path === "/runtime-tools/model/v1/messages")!.binaries).toEqual([{path:"/usr/bin/opencode"}]);
  const again=compileSandboxPolicy({...input,candidate:first.compiledPolicy});expect(again.proverResult).toBe("pass");
  expect(again.staticPolicyFingerprint).toBe(first.staticPolicyFingerprint);expect(again.compiledPolicy.network.destinations).toHaveLength(2);
  expect(nativeSha256(projection(again).document)).toBe(nativeSha256(projected.document));
  expect(projectOpenShellPolicy(input.boundary,first.modelBrokerEndpoint,first.credentialBrokerEndpoints).document).toEqual(projected.document);
 });
 it.each(["missing_model","missing_app","unprotected","wrong_origin","stale","membership","revoked","gateway_changed","method_changed","path_changed","source_changed"])("rejects missing/currentness mismatch: %s",kind=>{
  const input=setup(),previous=compileSandboxPolicy(input);input.candidate=previous.compiledPolicy;
  if(kind==="missing_model")delete input.capabilities.modelBrokerProviderProfile!.binaries;
  if(kind==="missing_app")delete input.capabilities.credentialBrokerProviderProfile!.binaries;
  if(kind==="unprotected"){input.capabilities.evidenceKind="local_fixture";delete input.capabilities.qualificationProbeFixture;}
  if(kind==="wrong_origin")input.credentialBrokerOrigin="https://changed.example.test";
  if(kind==="stale")input.capabilities.expiresAt=new Date(Date.now()-1000).toISOString();
  if(kind==="membership")input.capabilities.credentialBrokerProviderProfile!.binaries=["/usr/bin/other"];
  if(kind==="revoked")input.authorizedConnectionGrantHashes={};
  if(kind==="gateway_changed"){input.credentialBrokerBindings[0]!.gatewayPublicId="gateway_2";input.credentialBrokerBindings[0]!.endpointPath="/mcp/gateways/gateway_2";}
  if(kind==="method_changed")input.candidate.network.destinations[0]!.methods=["GET"];
  if(kind==="path_changed")input.candidate.network.destinations[0]!.pathPrefixes=["/mcp/gateways/gateway_1/extra"];
  if(kind==="source_changed")input.credentialBrokerBindings[0]!.grantVersionHash="b".repeat(64);
  expect(compileSandboxPolicy(input).proverResult).not.toBe("pass");
 });
 it.each(["writable","read_missing","denied","write_ancestor","write_descendant"])("does not derive model endpoint for a nonimmutable caller: %s",kind=>{
  const input=setup();
  if(kind==="writable")input.capabilities.modelBrokerProviderProfile!.binaries=["/work/opencode"];
  if(kind==="read_missing")input.capabilities.modelBrokerProviderProfile!.binaries=["/outside/opencode"];
  if(kind==="denied")input.candidate.filesystem.deniedPaths=["/usr/bin/opencode"];
  if(kind==="write_ancestor")input.candidate.filesystem.writePaths=["/usr"];
  if(kind==="write_descendant")input.candidate.filesystem.writePaths=["/usr/bin/opencode/state"];
  const compiled=compileSandboxPolicy(input);expect(compiled.proverResult).not.toBe("pass");
  expect(compiled.unsupportedFeatures).toContain("managed_model_binary_not_immutable");expect(compiled.modelBrokerEndpoint).toBeUndefined();
 });
 it("binds changed verified profile binary vectors and derived endpoints into current fingerprints",()=>{
  const input=setup(),first=compileSandboxPolicy(input);input.capabilities.modelBrokerProviderProfile!.binaries=["/usr/bin/other"];
  const changed=compileSandboxPolicy({...input,candidate:first.compiledPolicy});expect(changed.proverResult).toBe("pass");
  expect(changed.staticPolicyFingerprint).not.toBe(first.staticPolicyFingerprint);expect(changed.modelBrokerEndpoint!.binaries).toEqual(["/usr/bin/other"]);
 });
 it("keeps arbitrary network destinations and general process/syscall restrictions unsupported",()=>{
  const input=setup();input.boundary.network.destinations=[{hostname:"other.test",port:443,methods:["GET"],pathPrefixes:["/"]}];input.candidate=structuredClone(input.boundary);
  const compiled=compileSandboxPolicy(input);expect(projection(compiled).unsupportedFeatures).toContain("network_calling_binary_missing");
  input.candidate.process.allowedBinaries=["/usr/bin/curl"];input.candidate.process.allowedSyscalls=["read"];
  const projected=projectOpenShellPolicy(input.candidate);expect(projected.unsupportedFeatures).toContain("process_binary_allowlist_requires_outer_enforcement");expect(projected.unsupportedFeatures).toContain("custom_syscall_allowlist_requires_outer_enforcement");
 });
 it("does not accept caller-supplied App mappings without the matching credential binding or malformed exact route",()=>{
  const compiled=compileSandboxPolicy(setup());
  const wrong=structuredClone(compiled.credentialBrokerEndpoints!);wrong[0]!.connectionId="wrong";
  expect(projectOpenShellPolicy(compiled.compiledPolicy,compiled.modelBrokerEndpoint,wrong).unsupportedFeatures).toContain("credential_broker_caller_route_invalid");
  wrong[0]!.connectionId=connectionId;wrong[0]!.path+="?query=1";
  expect(projectOpenShellPolicy(compiled.compiledPolicy,compiled.modelBrokerEndpoint,wrong).unsupportedFeatures).toContain("credential_broker_caller_route_invalid");
 });
 it.each([["relative"],["/usr/../curl"],["/usr//curl"],["/usr/bin/*"],["/usr/bin/[x]"],["/usr/bin/curl\t"],["/"],["/usr/bin/curl","/usr/bin/curl"]].map(binaries=>({binaries})))("rejects nonliteral/duplicate profile selectors $binaries",({binaries})=>{
  expect(sandboxNetworkCallerBinariesSchema.safeParse(binaries).success).toBe(false);
 });
 it("retains backwards parse compatibility while legacy profile absence cannot qualify routes",()=>{
  const input=setup();delete input.capabilities.modelBrokerProviderProfile!.binaries;delete input.capabilities.credentialBrokerProviderProfile!.binaries;
  expect(sandboxCapabilitySnapshotSchema.safeParse(input.capabilities).success).toBe(true);expect(compileSandboxPolicy(input).proverResult).not.toBe("pass");
 });
 it("keeps positive backend apply/start with a controlled mock Host proof owner and pinned real prover",async()=>{
  // Component-level controlled Host owner only; this does not establish physical Host proof or SDK qualification.
  const input=setup();input.capabilities.credentialBrokerProviderProfile!.binaries=["/usr/bin/curl","/usr/bin/node"];
  const compiled=compileSandboxPolicy(input);expect(compiled.proverResult).toBe("pass");
  const db={select:vi.fn(()=>{throw Error("metadata must not resolve a secret");})} as unknown as Db;
  const gateway=createToolGatewayService(db),runtime=runtimeControlService(db,{runtime:{suspectSeconds:90,unreachableSeconds:600,relayPort:3102}} as SaasPlatformConfig,undefined,{credentialBrokerOrigin:origin});
  gateway.setSandboxBrokerAuthority(runtime.authorizeSandboxBrokerCapability,origin);registerAssignedMcpGateway(db,gateway);
  const identity={companyId:"company",bindingId:"binding",cellId:"cell",cellGeneration:"1",sandboxRef:"sandbox"};
  const prover={executable:process.env.AW_V7_OPENSHELL_PROVER ?? "/workspace/v10-preparation/tools/openshell-prover-v0.1.2/openshell-prover",
    executableSha256:"3e80c0d041a7552d57cc338868bc825a6261e21b5f29a7d7527bcc7926d423f1"};
  let effective=projection(compiled).document, observedHash:string|null=null;
  const bridge:OpenShellHostBridge={
   capabilities:async()=>input.capabilities,
   prepare:vi.fn(async(scope,provisioning)=>({...scope,backendVersion:"0.1.2",hostEpoch:input.capabilities.qualificationTarget!.hostEpoch,
    imageDigest:input.capabilities.sandboxImageDigest,sandboxId:input.capabilities.qualificationTarget!.sandboxId,
    containerId:input.capabilities.qualificationTarget!.containerId,bindingVersion:input.capabilities.qualificationTarget!.bindingVersion,
    provisioningHash:"3".repeat(64),policyHash:provisioning?.policyHash})),
   inspect:vi.fn(async()=>({state:"stopped" as const,generation:identity.cellGeneration,imageDigest:input.capabilities.sandboxImageDigest,controlsHealthy:true,policyHash:observedHash})),
   effectivePolicy:vi.fn(async()=>effective),
   provePolicy:vi.fn(async(_scope,request)=>{
    const checked=await checkOpenShellBoundary({...prover,candidate:request.candidateDocument,boundary:request.boundaryDocument});
    const target={hostEpoch:input.capabilities.qualificationTarget!.hostEpoch,imageDigest:input.capabilities.sandboxImageDigest,
     sandboxId:request.sandboxId,containerId:request.containerId,bindingVersion:request.bindingVersion,
     provisioningHash:request.provisioningHash,policyHash:request.policyHash};
    const proofFields={schema:"paperclip.sandbox-host-policy-proof.v1",stage:request.stage,result:checked.result,
     coveredDomains:checked.coveredDomains,candidateDocumentHash:request.candidateDocumentHash,
     boundaryDocumentHash:request.boundaryDocumentHash,effectiveDocumentHash:nativeSha256(effective),
     proverVersion:"0.1.2",proverSha256:prover.executableSha256,target};
    const reply=sandboxHostReplySchema.parse({action:"prove_policy" as const,stage:request.stage,result:checked.result,coveredDomains:checked.coveredDomains,
     candidateDocumentHash:request.candidateDocumentHash,boundaryDocumentHash:request.boundaryDocumentHash,
     effectiveDocumentHash:nativeSha256(effective),proverVersion:"0.1.2" as const,proverSha256:prover.executableSha256,
     target,evidenceHash:nativeSha256(proofFields)});
    if(reply.action!=="prove_policy")throw Error("Policy proof action changed");
    return reply;
   }),
   apply:vi.fn(async value=>{effective=value.document;observedHash=value.policyHash;return {applied:true,policyHash:value.policyHash};}),
   start:vi.fn(async()=>({operationId:"actual-backend-start"})),revokeProviders:vi.fn(async()=>{}),stop:vi.fn(async()=>({operationId:"stop"})),destroy:vi.fn(async()=>({operationId:"destroy"})),probe:vi.fn(),
  };
  const backend=openShellBackend({identity,boundary:input.boundary,bridge,evidenceKind:"protected_host_report",credentialBrokerDatabase:db,credentialBrokerOrigin:origin,resolveCredentialBrokerBindings:async()=>({authorizedConnectionGrantHashes:input.authorizedConnectionGrantHashes,bindings:input.credentialBrokerBindings}),prover});
  const expiresAt=new Date(Date.now()+60000).toISOString();
  await backend.prepareSandbox!(identity,{purpose:"admission",operationKey:"prepare",bindingVersion:1,expiresAt,policy:compiled});
  const value={...identity,policy:compiled,currentStaticFingerprint:null,expiresAt,idempotencyKey:"apply"};
  expect((await backend.applyPolicy(value)).applied).toBe(true);
  expect(bridge.provePolicy).toHaveBeenCalledTimes(2);
  expect(vi.mocked(bridge.provePolicy!).mock.calls.map(([,proof])=>proof.stage)).toEqual(["requested","effective"]);
  expect(await backend.startWorkload({...value,idempotencyKey:"start"})).toEqual({operationId:"actual-backend-start"});
  expect(bridge.provePolicy).toHaveBeenCalledTimes(3);
  expect(vi.mocked(bridge.provePolicy!).mock.calls.map(([,proof])=>proof.stage)).toEqual(["requested","effective","effective"]);
  expect(new Set(vi.mocked(bridge.provePolicy!).mock.calls.map(([, ,key])=>key)).size).toBe(3);
  expect(bridge.effectivePolicy).toHaveBeenCalledTimes(2);expect(bridge.revokeProviders).not.toHaveBeenCalled();
  expect(bridge.apply).toHaveBeenCalledWith(expect.objectContaining({credentialProviderProfile:{id:"app",hash:"b".repeat(64),binaries:["/usr/bin/curl","/usr/bin/node"]}}));
  const appRoute=Object.values(effective.network_policies).find(route=>route.endpoints[0]!.rules[0]!.allow.path === "/mcp/gateways/gateway_1");
  expect(appRoute!.binaries).toEqual([{path:"/usr/bin/curl"}]);
  input.capabilities.modelBrokerProviderProfile!.binaries=["/work/opencode"];
  await expect(backend.startWorkload({...value,idempotencyKey:"stale-start"})).rejects.toThrow("qualification changed");
  expect(bridge.start).toHaveBeenCalledTimes(1);
  input.capabilities.modelBrokerProviderProfile!.binaries=["/usr/bin/opencode"];
  const originalOwner=vi.mocked(bridge.provePolicy!).getMockImplementation();expect(originalOwner).toBeDefined();
  vi.mocked(bridge.provePolicy!).mockImplementationOnce(async(scope,request,idempotencyKey)=>{
   const reply=await originalOwner!(scope,request,idempotencyKey);
   return {...reply,target:{...reply.target,containerId:"f".repeat(64)}};
  });
  await expect(backend.startWorkload({...value,idempotencyKey:"wrong-proof-target"})).rejects.toThrow("Protected Host did not return a complete proof");
  vi.mocked(bridge.provePolicy!).mockImplementationOnce(async(scope,request,idempotencyKey)=>{
   const reply=await originalOwner!(scope,request,idempotencyKey);
   return {...reply,evidenceHash:"0".repeat(64)};
  });
  await expect(backend.startWorkload({...value,idempotencyKey:"wrong-proof-hash"})).rejects.toThrow("Protected Host did not return a complete proof");
  expect(bridge.start).toHaveBeenCalledTimes(1);
 });
 it("fails closed when a protected Host policy proof owner is absent",async()=>{
  const input=setup();const compiled=compileSandboxPolicy(input);
  const db={select:vi.fn(()=>{throw Error("metadata must not resolve a secret");})} as unknown as Db;
  const gateway=createToolGatewayService(db),runtime=runtimeControlService(db,{runtime:{suspectSeconds:90,unreachableSeconds:600,relayPort:3102}} as SaasPlatformConfig,undefined,{credentialBrokerOrigin:origin});
  gateway.setSandboxBrokerAuthority(runtime.authorizeSandboxBrokerCapability,origin);registerAssignedMcpGateway(db,gateway);
  const identity={companyId:"company",bindingId:"binding",cellId:"cell",cellGeneration:"1",sandboxRef:"sandbox"};
  const effective=projection(compiled).document;
  const bridge:OpenShellHostBridge={capabilities:async()=>input.capabilities,
   prepare:vi.fn(async(scope,provisioning)=>({...scope,backendVersion:"0.1.2",hostEpoch:input.capabilities.qualificationTarget!.hostEpoch,
    imageDigest:input.capabilities.sandboxImageDigest,sandboxId:input.capabilities.qualificationTarget!.sandboxId,
    containerId:input.capabilities.qualificationTarget!.containerId,bindingVersion:input.capabilities.qualificationTarget!.bindingVersion,
    provisioningHash:"3".repeat(64),policyHash:provisioning?.policyHash})),
   inspect:vi.fn(async()=>({state:"stopped" as const,generation:identity.cellGeneration,imageDigest:input.capabilities.sandboxImageDigest,controlsHealthy:true,policyHash:null})),
   effectivePolicy:vi.fn(async()=>effective),apply:vi.fn(),start:vi.fn(),revokeProviders:vi.fn(),stop:vi.fn(),destroy:vi.fn(),probe:vi.fn()};
  const backend=openShellBackend({identity,boundary:input.boundary,bridge,evidenceKind:"protected_host_report",credentialBrokerDatabase:db,credentialBrokerOrigin:origin,resolveCredentialBrokerBindings:async()=>({authorizedConnectionGrantHashes:input.authorizedConnectionGrantHashes,bindings:input.credentialBrokerBindings}),prover:{executable:process.env.AW_V7_OPENSHELL_PROVER ?? "/workspace/v10-preparation/tools/openshell-prover-v0.1.2/openshell-prover",executableSha256:"3e80c0d041a7552d57cc338868bc825a6261e21b5f29a7d7527bcc7926d423f1"}});
  const expiresAt=new Date(Date.now()+60000).toISOString();
  await backend.prepareSandbox!(identity,{purpose:"admission",operationKey:"prepare",bindingVersion:1,expiresAt,policy:compiled});
  await expect(backend.applyPolicy({...identity,policy:compiled,currentStaticFingerprint:null,expiresAt,idempotencyKey:"apply"}))
   .rejects.toThrow("A protected Host policy proof owner is required");
  expect(bridge.apply).not.toHaveBeenCalled();expect(bridge.start).not.toHaveBeenCalled();
 });
 it("the pinned real prover parses and proves the exact App/model documents",async()=>{
  const compiled=compileSandboxPolicy(setup()),projected=projection(compiled);expect(projected.unsupportedFeatures).toEqual([]);
  const result=await checkOpenShellBoundary({executable:process.env.AW_V7_OPENSHELL_PROVER ?? "/workspace/v10-preparation/tools/openshell-prover-v0.1.2/openshell-prover",executableSha256:"3e80c0d041a7552d57cc338868bc825a6261e21b5f29a7d7527bcc7926d423f1",candidate:projected.document,boundary:projected.document});
  expect(result.result).toBe("within_boundary");expect(result.coveredDomains).toEqual(expect.arrayContaining(["filesystem","network_l4","network_rest","process","landlock"]));
 });
});
