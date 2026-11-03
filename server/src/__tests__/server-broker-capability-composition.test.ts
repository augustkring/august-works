import { readFileSync } from "node:fs";
import { describe,it,expect,vi } from "vitest";
import type { Db } from "@paperclipai/db";
import { SANDBOX_CONTROLS,sandboxCapabilitySnapshotSchema,type SandboxCapabilitySnapshot } from "@paperclipai/shared";
import { createToolGatewayService } from "../services/tool-gateway.js";
import { runtimeControlService,readSandboxBrokerAuthorityEnforcement } from "../services/runtime/control.js";
import type { SaasPlatformConfig } from "../saas-platform-config.js";
import { registerAssignedMcpGateway } from "../services/native-runtime/assigned-mcp-tools.js";
import { composeOpenShellBrokerCapabilities,openShellBackend,type OpenShellHostBridge } from "../services/execution-sandbox/openshell-backend.js";
import { compileSandboxPolicy } from "../services/execution-sandbox/policy-compiler.js";
import { sandboxCapabilityFacts } from "../services/execution-sandbox/sandbox-service.js";
import { nativeSha256 } from "../services/native-runtime/canonical.js";
import { policyFixture } from "./helpers/sandbox-fixture.js";
const origin="https://broker.example.test";
const hostDimensions=["host","port","method","path","binary"] as const;
const serverDimensions=["company","presence","expiry","revocation"] as const;
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
function owners() {
 const touched=vi.fn(()=>{throw Error("metadata composition must not read credentials or execute authority");});
 const db={select:touched,insert:touched,transaction:touched} as unknown as Db;
 const gateway=createToolGatewayService(db);
 const runtime=runtimeControlService(db,{runtime:{suspectSeconds:90,unreachableSeconds:600,relayPort:3102}} as SaasPlatformConfig,undefined,{credentialBrokerOrigin:origin});
 gateway.setSandboxBrokerAuthority(runtime.authorizeSandboxBrokerCapability,origin);
 registerAssignedMcpGateway(db,gateway);
 const resolver=async (policy:Parameters<NonNullable<Parameters<typeof openShellBackend>[0]["resolveCredentialBrokerBindings"]>>[0])=>gateway.resolveSandboxCredentialBrokerPolicyBindings({
  companyId:"company",agentId:"agent",runId:"run",responsibleUserId:"human",presenceId:"presence",bindings:policy.compiledPolicy.credentials.bindings});
 return {db,gateway,runtime,touched,options:{credentialBrokerDatabase:db,credentialBrokerOrigin:origin,resolveCredentialBrokerBindings:resolver}};
}
describe("server/Host broker capability composition",()=>{
 it("composes distinct enforced owners using the actual registered Gateway and RuntimeControl without credential reads",()=>{
  const o=owners();const value=composeOpenShellBrokerCapabilities(snapshot(),o.options);
  expect(value.credentialBindingDimensions).toEqual([...hostDimensions,...serverDimensions]);expect(o.touched).not.toHaveBeenCalled();
  expect(readSandboxBrokerAuthorityEnforcement(o.runtime.authorizeSandboxBrokerCapability)).toEqual({protocol:"sandbox_exec_v1",origin});
 });
 it.each([undefined, null, 123, {}, "", "not a URL", origin+"/api", origin+"/path", origin+"?q=1", origin+"#fragment", origin+"/?", origin+"/#", "https://user:password@broker.example.test", "http://broker.example.test"])("keeps the non-paid control constructor available without advertising authority for %s",value=>{
  const touched=vi.fn(()=>{throw Error("constructor must not execute a provider or credential operation");});
  const db={select:touched,transaction:touched} as unknown as Db;
  let runtime:ReturnType<typeof runtimeControlService>;
  expect(()=>{runtime=runtimeControlService(db,{runtime:{suspectSeconds:90,unreachableSeconds:600,relayPort:3102}} as SaasPlatformConfig,undefined,{credentialBrokerOrigin:value as string});}).not.toThrow();
  expect(typeof runtime!.request).toBe("function");
  expect(typeof runtime!.relay.stop).toBe("function");
  expect(readSandboxBrokerAuthorityEnforcement(runtime!.authorizeSandboxBrokerCapability)).toBeNull();
  expect(touched).not.toHaveBeenCalled();
 });
 it("does not trust an unknown or wrapped authority or copied public provenance labels",()=>{
  const o=owners();const unknown=Object.assign(vi.fn(),{protocol:"sandbox_exec_v1",origin});
  for(const authority of [unknown,(input:Parameters<typeof o.runtime.authorizeSandboxBrokerCapability>[0])=>o.runtime.authorizeSandboxBrokerCapability(input)]) {
   o.gateway.setSandboxBrokerAuthority(authority as typeof o.runtime.authorizeSandboxBrokerCapability,origin);
   expect(composeOpenShellBrokerCapabilities(snapshot(),o.options).credentialBindingDimensions).toEqual(hostDimensions);
  }
  expect(o.touched).not.toHaveBeenCalled();
 });
 it.each(["missing_db","missing_registry","missing_resolver","replaced_canonical_resolver","wrong_origin","invalid_origin","profile_origin_missing","profile_origin_wrong","unprotected","host_endpoint_missing"])("fails closed: %s",kind=>{
  const o=owners();const raw=snapshot();const options={...o.options};
  if(kind==="missing_db")delete options.credentialBrokerDatabase;
  if(kind==="missing_registry")options.credentialBrokerDatabase={} as Db;
  if(kind==="missing_resolver")delete options.resolveCredentialBrokerBindings;
  if(kind==="replaced_canonical_resolver")o.gateway.resolveSandboxCredentialBrokerPolicyBindings=vi.fn();
  if(kind==="wrong_origin")options.credentialBrokerOrigin="https://wrong.example.test";
  if(kind==="invalid_origin")options.credentialBrokerOrigin=origin+"/path";
  if(kind==="profile_origin_missing")delete raw.credentialBrokerProviderProfile!.origin;
  if(kind==="profile_origin_wrong")raw.credentialBrokerProviderProfile!.origin="https://wrong.example.test";
  if(kind==="unprotected")raw.evidenceKind="local_fixture";
  if(kind==="host_endpoint_missing")raw.credentialBindingDimensions=raw.credentialBindingDimensions.filter(d=>d!=="path");
  const projected=composeOpenShellBrokerCapabilities(raw,options);
  expect(projected.credentialBindingDimensions.some(d=>serverDimensions.includes(d as typeof serverDimensions[number]))).toBe(false);expect(o.touched).not.toHaveBeenCalled();
 });
 it("strips raw Host assertions of server authority even when the Host advertises all nine",()=>{
  const raw=snapshot();raw.credentialBindingDimensions.push(...serverDimensions);
  expect(composeOpenShellBrokerCapabilities(raw,{}).credentialBindingDimensions).toEqual(hostDimensions);
 });
 it("never derives business profile authority from the qualification-only canary",()=>{
  const o=owners();const raw=snapshot();delete raw.credentialBrokerProviderProfile;
  expect(composeOpenShellBrokerCapabilities(raw,o.options).credentialBindingDimensions).toEqual(hostDimensions);
 });
 it("does not invent binary enforcement for an unpinned Host profile",()=>{
  const o=owners();const raw=snapshot();raw.credentialBindingDimensions=raw.credentialBindingDimensions.filter(d=>d!=="binary");
  expect(composeOpenShellBrokerCapabilities(raw,o.options).credentialBindingDimensions).not.toContain("binary");
 });
 it.each([origin+"/",origin+"/path",origin+"?q=1","https://user@broker.example.test","http://broker.example.test"])("rejects nonliteral profile origin %s",value=>{
  const raw=snapshot();raw.credentialBrokerProviderProfile!.origin=value;expect(sandboxCapabilitySnapshotSchema.safeParse(raw).success).toBe(false);
 });
 it("uses the same projection on actual backend capability reads",async()=>{
  const o=owners();const raw=snapshot();const bridge={capabilities:vi.fn(async()=>raw)} as unknown as OpenShellHostBridge;
  const backend=openShellBackend({...o.options,identity:{companyId:"company",bindingId:"binding",cellId:"cell",cellGeneration:"1",sandboxRef:"sandbox"},boundary:policyFixture(),bridge,evidenceKind:"protected_host_report",prover:{executable:"unused",executableSha256:"0".repeat(64)}});
  expect((await backend.capabilities())?.credentialBindingDimensions).toEqual([...hostDimensions,...serverDimensions]);expect(o.touched).not.toHaveBeenCalled();
 });
 it.each(["app_id","app_hash","app_origin","model_id","model_hash","model_origin","model_added","model_removed"])("binds full profile drift in stable qualification facts and policy fingerprint: %s",kind=>{
  const raw=snapshot(),changed=structuredClone(raw);
  if(kind==="model_added")delete raw.modelBrokerProviderProfile;
  else if(kind==="model_removed")delete changed.modelBrokerProviderProfile;
  else {const [role,field]=kind.split("_");const profile=role==="app"?changed.credentialBrokerProviderProfile!:changed.modelBrokerProviderProfile!;
   if(field==="id")profile.id+="-new";else if(field==="hash")profile.hash="e".repeat(64);else profile.origin="https://other.example.test";}
  expect(nativeSha256(sandboxCapabilityFacts(changed))).not.toBe(nativeSha256(sandboxCapabilityFacts(raw)));
  const boundary=policyFixture();const make=(capabilities:SandboxCapabilitySnapshot)=>compileSandboxPolicy({boundary,candidate:boundary,capabilities,authorizedConnectionGrantHashes:{},credentialBrokerOrigin:origin,sourcePolicyRefs:[]});
  expect(make(changed).staticPolicyFingerprint).not.toBe(make(raw).staticPolicyFingerprint);
 });
});
