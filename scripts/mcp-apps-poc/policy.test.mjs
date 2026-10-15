import { test } from "node:test";
import assert from "node:assert/strict";
import { APP_CSP, APP_MIME, admitPocResource, distinctPocOrigins, parsePocRpc, stringifyPocMessage, rpcRefusal } from "./policy.mjs";
const expected = { uri: "ui://aw-anonymous-poc/read-only", connectionId: "anonymous-c0-fixture", revision: "1", sha256: "a".repeat(64) };
const resource = { ...expected, mimeType: APP_MIME, text: "<!doctype html><html lang=\"en\"><head></head><body>Synthetic</body></html>" };
test("reviewed resource identity is exact, bounded and non-authoritative", () => {
  assert.deepEqual(admitPocResource(JSON.stringify(resource), expected), resource);
  for (const changed of [{uri:"https://attacker.test"},{mimeType:"text/html"},{connectionId:"another-connection"},{revision:"2"},{sha256:"b".repeat(64)},{cookie:"private"},{text:"x".repeat(65536)}])
    assert.throws(() => admitPocResource(JSON.stringify({ ...resource, ...changed }), expected), /^Error: Sandbox input unavailable$/);
});
test("C0 origins use distinct loopback IPs and reject same-host/different-port and remote origins", () => {
  assert.deepEqual(distinctPocOrigins("http://127.0.0.1:1234", "http://127.0.0.2:5678"), {hostOrigin:"http://127.0.0.1:1234",sandboxOrigin:"http://127.0.0.2:5678"});
  for (const sandbox of ["http://127.0.0.1:5678", "https://attacker.test", "http://127.0.0.2:5678/path", "http://user:password@127.0.0.2:5678"])
    assert.throws(() => distinctPocOrigins("http://127.0.0.1:1234", sandbox));
});
test("bounded JSON-RPC refuses prototype fields, private oversized payloads, malformed IDs and mixed responses", () => {
  assert.equal(parsePocRpc('{"jsonrpc":"2.0","id":1,"method":"ui/initialize","params":{}}').id, 1);
  for (const wire of ['{"jsonrpc":"2.0","method":"tools/call","params":{"__proto__":{}}}', '{"jsonrpc":"2.0","id":null,"method":"tools/call"}', '{"jsonrpc":"2.0","id":1,"result":{},"error":{}}', '{"jsonrpc":"2.0","method":"tools/call","result":{}}', JSON.stringify({jsonrpc:"2.0",method:"tools/call",params:{private:"x".repeat(8192)}}), null, {}])
    assert.throws(() => parsePocRpc(wire), /^Error: Sandbox input unavailable$/);
});
test("resource permissions and unimplemented RPC cannot become tools or external capabilities", () => {
  for (const directive of ["connect-src 'none'", "frame-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"])
    assert.ok(APP_CSP.includes(directive));
  assert.deepEqual(rpcRefusal("one"), {jsonrpc:"2.0",id:"one",error:{code:-32601,message:"This experimental host does not admit this operation"}});
});

test("postMessage traversal refuses oversized/exotic/deep/accessor data before serialization",()=>{
  const rpc={jsonrpc:"2.0",method:"tools/call",params:{name:"write",arguments:{}}};
  assert.deepEqual(parsePocRpc(stringifyPocMessage(rpc)),rpc);
  let calls=0;const accessor={};Object.defineProperty(accessor,"private",{enumerable:true,get(){calls++;return "PRIVATE";}});
  for(const value of [accessor,new Date(),{private:"x".repeat(8193)},new Uint8Array(100_000)])assert.throws(()=>stringifyPocMessage(value));
  assert.equal(calls,0);let deep={};for(let n=0;n<10;n++)deep={next:deep};assert.throws(()=>stringifyPocMessage(deep));
});
